"""Tests use synthetic fixtures and temporary storage; no network or real email."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch, MagicMock
from backend.domain import Leg, Search, eligible, jobs, local_instant
from backend.engine import make_event, persist_snapshots, Monitor
from backend import store, mail, engine


def config():
    return Search(name="Teste",origins=["THE"],destinations=["GRU","CGH"],
                  outbound=Leg(start="2026-11-05T22:00",end="2026-11-06T06:00",max_duration=480,stops=[0,1]),
                  target_cents=120000,notify_email=True,notify_whatsapp=False)


def flight(departure="2026-11-06T02:35",price=119700,stops=0,duration=195):
    return {"id":"test-flight","origin":"THE","destination":"GRU","departure":departure,
            "arrival":"2026-11-06T05:50","duration_minutes":duration,"stops":stops,"layovers":[] if not stops else [90],
            "via":[],"airlines":["GOL"],"price_cents":price,"adults":1,"collected_at":time.time(),"search_url":"https://www.google.com/travel/flights"}


class FilterTests(unittest.TestCase):
    def test_midnight_window_boundaries(self):
        leg=config().outbound
        for value in ("2026-11-05T22:00","2026-11-06T00:15","2026-11-06T06:00"):
            self.assertTrue(eligible(flight(value),leg),value)
        for value in ("2026-11-05T21:59","2026-11-05T02:35","2026-11-06T06:01"):
            self.assertFalse(eligible(flight(value),leg),value)

    def test_cartesian_airports_and_dates(self):
        search=config()
        search.origins=["THE","SLZ"]
        tasks=jobs(search)
        self.assertEqual(len(tasks),8)
        self.assertEqual(len(set(tasks)),8)

    def test_duration_includes_connections_and_stops_are_exact(self):
        leg=config().outbound
        self.assertTrue(eligible(flight(duration=480),leg))
        self.assertFalse(eligible(flight(duration=481),leg))
        leg.stops=[1]
        self.assertFalse(eligible(flight(stops=0),leg))
        self.assertTrue(eligible(flight(stops=1),leg))
        self.assertFalse(eligible(flight(stops=2),leg))
        leg.stops=[2]
        self.assertTrue(eligible(flight(stops=3),leg))

    def test_optional_duration_does_not_exclude_long_itineraries(self):
        leg=Leg(start="2026-11-05T22:00",end="2026-11-06T06:00")
        self.assertIsNone(leg.max_duration)
        self.assertTrue(eligible(flight(stops=5,duration=4200),leg))
        leg.max_duration=2880
        self.assertFalse(eligible(flight(stops=5,duration=4200),leg))
        self.assertTrue(eligible(flight(stops=5,duration=2880),leg))
        legacy=Leg(start=leg.start,end=leg.end,max_duration=1440)
        self.assertEqual(legacy.max_duration,1440)

    def test_connection_filter_does_not_remove_nonstop(self):
        leg=config().outbound
        leg.max_layover=60
        self.assertTrue(eligible(flight(),leg))
        self.assertFalse(eligible(flight(stops=1),leg))

    def test_arrival_filter_is_independent(self):
        leg=config().outbound
        option=flight()
        option["arrival"]="2026-11-06T09:00"
        self.assertTrue(eligible(option,leg))
        leg.arrival_before="2026-11-06T08:59"
        self.assertFalse(eligible(option,leg))

    def test_timezones_are_not_subtracted_as_local_clocks(self):
        delta=local_instant("2026-11-05T16:00","GRU")-local_instant("2026-11-05T12:00","RBR")
        self.assertEqual(delta.total_seconds()/3600,2)

    def test_first_target_has_no_invented_savings(self):
        event=make_event(config(),flight(),None)
        self.assertEqual(event["kind"],"target")
        self.assertIsNone(event["previous"])
        self.assertIsNone(event["saving_cents"])

    def test_same_opportunity_and_quiet_interval(self):
        self.assertIsNone(make_event(config(),flight(),130000,119700,time.time()-10))
        search=config();search.target_cents=None
        self.assertIsNone(make_event(search,flight(),119700))
        self.assertEqual(make_event(search,flight(price=99300),116500)["saving_percent"],15)


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.folder=Path(self.temp.name)
        self.patches=[patch.object(store,"DATA_DIR",self.folder),patch.object(mail,"DATA_DIR",self.folder),patch.object(mail,"SETTINGS_FILE",self.folder/"smtp-private.json")]
        for p in self.patches:p.start()
        store.setup(seed=False)
        from backend import accounts
        from fastapi import Response
        user=accounts.register(accounts.Registration(name='Fixture user',country='US',phone='6502530000',password='fixture-password-only',emails=['to@example.org']),Response())
        with store.db() as c:
            self.sid=store.add_search(c,config(),user['id'])
            self.cid=c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,?,?,?,?)",(self.sid,1,time.time(),"running",2)).lastrowid

    def tearDown(self):
        for p in self.patches:p.stop()
        self.temp.cleanup()

    def result(self,status="ok"):
        return {"direction":"outbound","origin":"THE","destination":"GRU","status":status,"flights":[flight()] if status=="ok" else []}

    def test_partial_cycle_never_alerts(self):
        with store.db() as c:
            persist_snapshots(c,self.sid,1,self.cid,config(),[self.result(),self.result("error")])
            self.assertEqual(c.execute("SELECT COUNT(*) FROM alerts").fetchone()[0],0)
            self.assertEqual(c.execute("SELECT complete FROM snapshots").fetchone()[0],0)

    def test_event_persists_once_and_waits_for_configuration(self):
        with store.db() as c:
            persist_snapshots(c,self.sid,1,self.cid,config(),[self.result()])
            persist_snapshots(c,self.sid,1,self.cid,config(),[self.result()])
            alerts=c.execute("SELECT * FROM alerts").fetchall()
            self.assertEqual(len(alerts),1)
            self.assertEqual(alerts[0]["status"],"waiting_service")
            blocked=c.execute("SELECT status,attempts FROM outbox").fetchall()
            self.assertEqual(len(blocked),1)
            self.assertEqual(blocked[0]['status'],'waiting_service')
            self.assertEqual(blocked[0]['attempts'],0)

    def test_new_filter_version_does_not_claim_market_drop(self):
        with store.db() as c:
            c.execute("INSERT INTO baselines(search_id,version,direction,price,flight,alert_floor,alerted) VALUES(?,?,?,?,?,?,?)",(self.sid,1,"outbound",281000,json.dumps(flight(price=281000)),None,None))
            persist_snapshots(c,self.sid,2,self.cid,config(),[self.result()])
            event=json.loads(c.execute("SELECT payload FROM alerts").fetchone()[0])
            self.assertEqual(event["kind"],"target")
            self.assertIsNone(event["previous"])

    def test_smtp_password_is_private_and_redacted(self):
        mail.save_settings(mail.SMTPSettings(enabled=True,host="smtp.example.org",username="user",password="local-test-secret",sender="from@example.org",recipient="to@example.org"))
        self.assertNotIn("password",mail.public_settings())
        self.assertTrue(mail.public_settings()["password_set"])
        self.assertEqual(mail.SETTINGS_FILE.stat().st_mode&0o777,0o600)
        with self.assertRaises(ValueError):
            mail.save_settings(mail.SMTPSettings(host="different.example.org",username="user"))

    def test_adapter_upgrade_creates_new_comparison_version(self):
        with patch.object(store,"ADAPTER_VERSION","test-new-source-version"):
            store.setup(seed=False)
        with store.db() as c:
            row=c.execute("SELECT version,last_success FROM searches WHERE id=?",(self.sid,)).fetchone()
            self.assertEqual(row["version"],2)
            self.assertIsNone(row["last_success"])

    def test_inbound_and_outbound_events_share_one_email(self):
        search=config()
        search.inbound=Leg(start="2026-11-09T00:00",end="2026-11-09T23:59")
        inbound=flight(departure="2026-11-09T12:20",price=94500)
        inbound.update({"origin":"CGH","destination":"THE","arrival":"2026-11-09T17:25"})
        mail.save_settings(mail.SMTPSettings(enabled=True,host="smtp.example.org",sender="from@example.org",recipient="to@example.org"))
        with store.db() as c:
            persist_snapshots(c,self.sid,1,self.cid,search,[self.result(),{"direction":"inbound","status":"ok","flights":[inbound]}])
            messages=c.execute("SELECT alert_ids,body FROM outbox").fetchall()
            self.assertEqual(len(messages),1)
            self.assertEqual(len(json.loads(messages[0]["alert_ids"])),2)
            self.assertIn("IDA",messages[0]["body"])
            self.assertIn("VOLTA",messages[0]["body"])

    def test_paused_search_cancels_pending_message(self):
        mail.save_settings(mail.SMTPSettings(enabled=True,host="smtp.example.org",sender="from@example.org",recipient="to@example.org"))
        with store.db() as c:
            persist_snapshots(c,self.sid,1,self.cid,config(),[self.result()])
            c.execute("UPDATE searches SET active=0 WHERE id=?",(self.sid,))
        with patch.object(mail,"transmit") as transport:
            Monitor().send_one()
            transport.assert_not_called()
        with store.db() as c:
            self.assertEqual(c.execute("SELECT status FROM outbox").fetchone()[0],"cancelled")

    def test_quit_failure_does_not_retry_an_accepted_message(self):
        client=MagicMock()
        client.send_message.return_value={}
        client.quit.side_effect=OSError("connection closed after SMTP acceptance")
        config_smtp=mail.SMTPSettings(host="smtp.example.org",sender="a@example.org",recipient="b@example.org").model_dump()
        with patch.object(mail.smtplib,"SMTP",return_value=client):
            mail.transmit(config_smtp,"test","Test","Fixture only")
        client.send_message.assert_called_once()
        client.close.assert_called_once()


HOUR=3600
DAY=24*HOUR


class AlertPolicyTests(unittest.TestCase):
    """Price sequences through persist_snapshots on a fake clock; no channel unless a test turns one on."""
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.folder=Path(self.temp.name)
        self.quiet=False
        self.patches=[patch.object(store,"DATA_DIR",self.folder),patch.object(mail,"DATA_DIR",self.folder),patch.object(mail,"SETTINGS_FILE",self.folder/"smtp-private.json"),
                      patch("backend.accounts.search_is_quiet",side_effect=lambda c,sid,now=None:self.quiet)]
        for p in self.patches:p.start()
        store.setup(seed=False)
        self.start=time.time()

    def tearDown(self):
        for p in self.patches:p.stop()
        self.temp.cleanup()

    def trip(self,target=120000,inbound=False,**update):
        search=Search(name="Política",origins=["THE"],destinations=["GRU"],outbound=Leg(start="2090-11-05T00:00",end="2090-11-06T23:59"),
                      inbound=Leg(start="2090-11-09T00:00",end="2090-11-09T23:59") if inbound else None,
                      target_cents=target,min_drop_cents=5000,notify_email=False,notify_whatsapp=False).model_copy(update=update)
        with store.db() as c:return store.add_search(c,search),search

    def cycle(self,sid,search,seconds,prices,version=1):
        """One complete cycle with these best prices per direction; returns the reason of each direction's alert, or None."""
        fares={"outbound":dict(flight(departure="2090-11-05T12:00"),arrival="2090-11-05T15:15"),
               "inbound":dict(flight(departure="2090-11-09T12:00"),origin="GRU",destination="THE",arrival="2090-11-09T15:15")}
        results=[{"direction":d,"status":"ok","flights":[dict(fares[d],price_cents=p)]} for d,p in prices.items()]
        with patch.object(engine,"time",NS(time=lambda:self.start+seconds)),store.db() as c:
            cid=c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,?,?,'done',1)",(sid,version,self.start+seconds)).lastrowid
            persist_snapshots(c,sid,version,cid,search,results)
            found={r["direction"]:json.loads(r["payload"])["reason"] for r in c.execute("SELECT direction,payload FROM alerts WHERE cycle_id=?",(cid,))}
        return {d:found.get(d) for d in prices}

    def sequence(self,steps,target=120000):
        """steps: (seconds after the start, best outbound price)."""
        sid,search=self.trip(target)
        return [self.cycle(sid,search,seconds,{"outbound":price})["outbound"] for seconds,price in steps]

    def test_stable_price_is_not_resent_before_24_hours(self):
        steps=[(0,110000),(300,110000),(2*HOUR,110000),(2*HOUR+300,110000),(12*HOUR,110000),(24*HOUR-60,110000)]
        self.assertEqual(self.sequence(steps),["first",None,None,None,None,None])

    def test_one_reminder_per_day_while_the_target_is_still_met(self):
        steps=[(0,110000),(24*HOUR+300,110000),(24*HOUR+600,110000),(30*HOUR,112000),(48*HOUR,110000),(48*HOUR+600,110000)]
        self.assertEqual(self.sequence(steps),["first","reminder",None,None,None,"reminder"])
        # Without a target there is nothing to remind: a stable price after a drop stays silent.
        self.assertEqual(self.sequence([(0,130000),(300,124000),(25*HOUR,124000),(50*HOUR,124000)],target=None),[None,"first",None,None])

    def test_new_low_by_the_minimum_drop_alerts(self):
        steps=[(0,110000),(900,104000),(1800,100000),(2700,99000)]
        self.assertEqual(self.sequence(steps),["first","new_low",None,"new_low"])

    def test_drop_below_the_minimum_does_not_alert(self):
        self.assertEqual(self.sequence([(0,110000),(900,106000),(1800,105500),(2700,107000)]),["first",None,None,None])
        self.assertEqual(self.sequence([(0,130000),(900,124000),(1800,121000),(2700,122000)],target=None),[None,"first",None,None])

    def test_gradual_drop_counts_from_the_last_alert(self):
        steps=[(0,136000),(300,130000),(900,126000),(1500,122000),(2100,118000)]
        for target in (None,100000):
            with self.subTest(target=target):
                self.assertEqual(self.sequence(steps,target=target),[None,"first",None,"new_low",None])

    def test_rearmed_target_alerts_again(self):
        steps=[(0,110000),(900,130000),(1800,115000),(2700,125000),(3600,115000),(4500,125000),(5400,112000)]
        # Back above the target and crossing again alerts; flapping back to the price last alerted does not.
        self.assertEqual(self.sequence(steps),["first",None,"rearmed",None,None,None,"rearmed"])

    def test_rearm_needs_the_price_to_leave_the_target_by_the_minimum_drop(self):
        steps=[(0,110000),(900,123000),(1800,115000),(2700,126000),(3600,114000)]
        self.assertEqual(self.sequence(steps),["first",None,None,None,"rearmed"])
        # Without a minimum drop the margin is 2% of the target.
        loose=NS(target_cents=100000,min_drop_cents=0);now=time.time()
        self.assertIsNone(make_event(loose,flight(price=99000),101500,98000,now-HOUR,now,peak=101500))
        self.assertEqual(make_event(loose,flight(price=99000),101500,98000,now-HOUR,now,peak=102000)["reason"],"rearmed")

    def test_ten_minute_gap_holds_the_alert_without_losing_it(self):
        self.assertEqual(self.sequence([(0,110000),(599,104000),(1199,104000)]),["first",None,"new_low"])
        self.assertEqual(self.sequence([(0,110000),(600,104000)]),["first","new_low"])
        # A crossing inside the gap keeps the price above the target as its reference and alerts after it.
        self.assertEqual(self.sequence([(0,110000),(300,130000),(590,115000),(890,115000)]),["first",None,None,"rearmed"])
        # Without a target, the held drop is compared with the price before it.
        self.assertEqual(self.sequence([(0,140000),(300,134000),(800,128000),(1100,128000)],target=None),[None,"first",None,"new_low"])
        # A clock set back never blocks.
        self.assertEqual(self.sequence([(1000,110000),(400,104000)]),["first","new_low"])

    def test_outbound_and_inbound_keep_separate_floors(self):
        sid,search=self.trip(inbound=True)
        self.assertEqual(self.cycle(sid,search,0,{"outbound":110000,"inbound":90000}),{"outbound":"first","inbound":"first"})
        self.assertEqual(self.cycle(sid,search,900,{"outbound":104000,"inbound":90000}),{"outbound":"new_low","inbound":None})
        self.assertEqual(self.cycle(sid,search,1800,{"outbound":104000,"inbound":84000}),{"outbound":None,"inbound":"new_low"})

    def test_quiet_hours_hold_the_first_alert_and_the_reminder_until_after_them(self):
        sid,search=self.trip(notify_whatsapp=True)
        self.quiet=True
        self.assertEqual([self.cycle(sid,search,s,{"outbound":110000})["outbound"] for s in (0,300,600)],[None,None,None])
        with store.db() as c:self.assertEqual(c.execute("SELECT COUNT(*) FROM alerts").fetchone()[0],0,"No queue of silenced copies")
        self.quiet=False
        self.assertEqual(self.cycle(sid,search,900,{"outbound":110000})["outbound"],"first")
        self.quiet=True
        self.assertEqual([self.cycle(sid,search,s,{"outbound":110000})["outbound"] for s in (DAY+900,DAY+1200)],[None,None])
        self.quiet=False
        self.assertEqual(self.cycle(sid,search,DAY+1500,{"outbound":110000})["outbound"],"reminder")
        with store.db() as c:
            self.assertEqual([r[0] for r in c.execute("SELECT json_extract(payload,'$.reason') FROM alerts ORDER BY created")],["first","reminder"])
            self.assertEqual(c.execute("SELECT COUNT(*) FROM alerts WHERE status='quiet'").fetchone()[0],0)

    def test_quiet_hours_hold_new_lows_and_crossings_and_check_them_again_after(self):
        night=lambda sid,search,steps:[self.cycle(sid,search,s,{"outbound":p})["outbound"] for s,p in steps]
        # A new low at night that still holds in the morning is sent then, compared with the price before the night.
        sid,search=self.trip(notify_whatsapp=True)
        self.assertEqual(self.cycle(sid,search,0,{"outbound":110000})["outbound"],"first")
        self.quiet=True;self.assertEqual(night(sid,search,[(900,104000),(1200,103000)]),[None,None]);self.quiet=False
        self.assertEqual(self.cycle(sid,search,1500,{"outbound":103000})["outbound"],"new_low")
        with store.db() as c:
            event=json.loads(c.execute("SELECT payload FROM alerts ORDER BY created DESC LIMIT 1").fetchone()[0])
            self.assertEqual(event["previous"],110000);self.assertEqual(c.execute("SELECT COUNT(*) FROM alerts WHERE status='quiet'").fetchone()[0],0)
        # The price went back up during the night: nothing in the morning.
        sid,search=self.trip(notify_whatsapp=True)
        self.cycle(sid,search,0,{"outbound":110000})
        self.quiet=True;self.assertEqual(night(sid,search,[(900,104000),(1200,109000)]),[None,None]);self.quiet=False
        self.assertIsNone(self.cycle(sid,search,1500,{"outbound":109000})["outbound"])
        # A crossing back into the target at night: sent in the morning if it still holds, nothing if the price left again.
        for morning,expected in ((115000,"rearmed"),(130000,None)):
            with self.subTest(morning=morning):
                sid,search=self.trip(notify_whatsapp=True)
                self.cycle(sid,search,0,{"outbound":110000});self.cycle(sid,search,900,{"outbound":130000})
                self.quiet=True;self.assertEqual(night(sid,search,[(1800,115000),(2100,114000)]),[None,None]);self.quiet=False
                self.assertEqual(self.cycle(sid,search,2400,{"outbound":morning})["outbound"],expected)

    def test_edit_keeps_the_alert_state_unless_the_target_or_minimum_drop_changes(self):
        sid,search=self.trip()
        self.assertEqual(self.cycle(sid,search,0,{"outbound":110000})["outbound"],"first")
        renamed=search.model_copy(update={"name":"Outro nome","notify_email":True})
        self.assertIsNone(self.cycle(sid,renamed,900,{"outbound":110000},version=2)["outbound"],"A new name or channel does not alert again")
        self.assertEqual(self.cycle(sid,renamed,1800,{"outbound":104000},version=2)["outbound"],"new_low")
        retargeted=renamed.model_copy(update={"target_cents":115000})
        self.assertEqual(self.cycle(sid,retargeted,2700,{"outbound":104000},version=3)["outbound"],"first")
        dropped=retargeted.model_copy(update={"min_drop_cents":3000})
        self.assertEqual(self.cycle(sid,dropped,3600,{"outbound":104000},version=4)["outbound"],"first")
        with store.db() as c:
            event=json.loads(c.execute("SELECT payload FROM alerts WHERE version=4").fetchone()[0])
        self.assertIsNone(event["previous"],"The price is never carried across versions")

    def test_edit_of_the_search_itself_or_a_new_source_version_starts_over(self):
        changes={"destination":{"destinations":["CGH"]},"currency":{"currency":"USD"},"stops":{"outbound":Leg(start="2090-11-05T00:00",end="2090-11-06T23:59",stops=[0])},
                 "cabin":{"cabin":"business"},"passengers":{"adults":2}}
        for label,update in changes.items():
            with self.subTest(label):
                sid,search=self.trip()
                self.assertEqual(self.cycle(sid,search,0,{"outbound":110000})["outbound"],"first")
                self.assertEqual(self.cycle(sid,search.model_copy(update=update),900,{"outbound":110000},version=2)["outbound"],"first")
        # Only the name (or the language and the channels) keeps the floor.
        sid,search=self.trip()
        self.cycle(sid,search,0,{"outbound":110000})
        self.assertIsNone(self.cycle(sid,search.model_copy(update={"name":"Só o nome","language":"en"}),900,{"outbound":110000},version=2)["outbound"])
        # A new source version (store.setup bumps the version) compares from scratch.
        sid,search=self.trip()
        self.cycle(sid,search,0,{"outbound":110000})
        with patch.object(engine,"SOURCE_VERSION","fixture-next-source"):
            self.assertEqual(self.cycle(sid,search,900,{"outbound":110000},version=2)["outbound"],"first")
        # A baseline written before the rule existed (NULL) is never inherited.
        sid,search=self.trip()
        self.cycle(sid,search,0,{"outbound":110000})
        with store.db() as c:c.execute("UPDATE baselines SET rule=NULL WHERE search_id=?",(sid,))
        self.assertEqual(self.cycle(sid,search,900,{"outbound":110000},version=2)["outbound"],"first")

    def test_rule_names_its_fields_and_ignores_their_order(self):
        from backend.engine import alert_rule
        search=Search(origins=["THE","SLZ"],destinations=["GRU","CGH"],outbound=Leg(start="2090-11-05T00:00",end="2090-11-06T23:59",airlines=["LA","G3"]),target_cents=120000)
        same=search.model_copy(update={"origins":["SLZ","THE"],"destinations":["CGH","GRU"],"outbound":search.outbound.model_copy(update={"airlines":["G3","LA"]})})
        self.assertEqual(alert_rule(search,"outbound"),alert_rule(same,"outbound"),"The order of airports and airlines is not an edit")
        self.assertEqual(alert_rule(search,"outbound"),alert_rule(search.model_copy(update={"name":"Outro","notify_email":True,"language":"es"}),"outbound"))
        self.assertNotEqual(alert_rule(search,"outbound"),alert_rule(search.model_copy(update={"origins":["THE"]}),"outbound"))

    def test_rearm_margin_is_the_larger_of_the_minimum_drop_and_two_percent(self):
        search=Search(origins=["THE"],destinations=["GRU"],outbound=Leg(start="2090-11-05T00:00",end="2090-11-06T23:59"),target_cents=1000000,min_drop_cents=5000)
        now=time.time()
        self.assertIsNone(make_event(search,flight(price=990000),1010000,980000,now-HOUR,now,peak=1010000))
        self.assertEqual(make_event(search,flight(price=990000),1020000,980000,now-HOUR,now,peak=1020000)["reason"],"rearmed")

    def test_older_database_gets_the_rule_column_once(self):
        folder=Path(self.temp.name)/"older";folder.mkdir()
        import sqlite3
        with sqlite3.connect(folder/"radar.sqlite3") as c:
            c.execute("CREATE TABLE baselines(search_id TEXT NOT NULL, version INTEGER NOT NULL, direction TEXT NOT NULL, price INTEGER NOT NULL, flight TEXT NOT NULL, alert_floor INTEGER, alerted REAL, PRIMARY KEY(search_id, version, direction))")
            c.execute("INSERT INTO baselines VALUES('legacy',1,'outbound',110000,'{}',110000,1.0)")
        with patch.object(store,"DATA_DIR",folder):
            store.setup(seed=False);store.setup(seed=False)
            with store.db() as c:
                self.assertEqual([r[1] for r in c.execute("PRAGMA table_info(baselines)")].count("rule"),1)
                self.assertEqual(tuple(c.execute("SELECT price,alert_floor,rule FROM baselines").fetchone()),(110000,110000,None))

    def test_reminder_reaches_the_channel_with_its_own_title(self):
        sid,search=self.trip(notify_email=True)
        with patch("backend.accounts.alert_recipients",return_value=["a@example.org"]),patch.object(mail,"available",return_value=True):
            self.assertEqual([self.cycle(sid,search,s,{"outbound":110000})["outbound"] for s in (0,DAY+300)],["first","reminder"])
        with store.db() as c:
            bodies=[r[0] for r in c.execute("SELECT body FROM outbox ORDER BY created")]
            titles=[r[0] for r in c.execute("SELECT json_extract(payload,'$.title') FROM alerts ORDER BY created")]
        self.assertIn("Meta atingida",bodies[0]);self.assertIn("Ainda dentro da meta",bodies[1]);self.assertNotIn("Meta atingida",bodies[1])
        self.assertEqual(titles,["Meta atingida","Ainda dentro da meta"])

    def test_new_trip_defaults_to_whatsapp_and_saved_trips_keep_their_channels(self):
        search=Search(origins=["THE"],destinations=["GRU"],outbound=Leg(start="2090-11-05T00:00",end="2090-11-06T23:59"))
        self.assertTrue(search.notify_whatsapp);self.assertFalse(search.notify_email)
        legacy=search.model_copy(update={"notify_email":True,"notify_whatsapp":False})
        with store.db() as c:
            sid=store.add_search(c,search);old=store.add_search(c,legacy)
            stored={r["id"]:json.loads(r["config"]) for r in c.execute("SELECT id,config FROM searches")}
            loaded=store.decode_search(c.execute("SELECT * FROM searches WHERE id=?",(old,)).fetchone())["config"]
        self.assertEqual((stored[sid]["notify_whatsapp"],stored[sid]["notify_email"]),(True,False))
        self.assertEqual((loaded["notify_whatsapp"],loaded["notify_email"]),(False,True))


if __name__ == "__main__":
    unittest.main()
