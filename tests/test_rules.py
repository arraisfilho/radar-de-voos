"""Tests use synthetic fixtures and temporary storage; no network or real email."""
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
from backend.domain import Leg, Search, eligible, jobs, local_instant
from backend.engine import make_event, persist_snapshots, Monitor
from backend import store, mail


def config():
    return Search(name="Teste",origins=["THE"],destinations=["GRU","CGH"],
                  outbound=Leg(start="2026-11-05T22:00",end="2026-11-06T06:00",max_duration=480,stops=[0,1]),
                  target_cents=120000)


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
            c.execute("INSERT INTO baselines VALUES(?,?,?,?,?,?,?)",(self.sid,1,"outbound",281000,json.dumps(flight(price=281000)),None,None))
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


if __name__ == "__main__":
    unittest.main()
