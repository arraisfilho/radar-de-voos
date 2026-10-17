"""Worldwide routes, bag price intent, migration and opt-in LAN boundary."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import json
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.airports import AIRPORTS, search_airports
from backend.domain import Search, Leg, local_instant, eligible
from backend import collector
from backend.engine import fetch
from backend.store import decode_search
from backend.network import allowed_client, allowed_host


class WorldwideTests(unittest.TestCase):
    def test_catalog_lookup_international_and_accents(self):
        self.assertGreater(len(AIRPORTS), 7000)
        for query, expected in [('JFK','JFK'),('londres','LHR'),('lisboa','LIS'),('São Paulo','GRU'),('tokyo','HND')]:
            with self.subTest(query=query):
                self.assertIn(expected,[a['code'] for a in search_airports(query)])
        self.assertEqual(search_airports('JFK')[0]['timezone'],'America/New_York')
        self.assertEqual(search_airports('x'),[])
        self.assertEqual(search_airports('zzzz-no-airport'),[])

    def test_worldwide_config_and_fixed_interval(self):
        search=Search(origins=['lhr','CDG'],destinations=['JFK'],outbound=Leg(start='2090-11-05T22:00',end='2090-11-06T06:00'),interval=300,checked_bags=1)
        self.assertEqual(search.origins,['LHR','CDG'])
        self.assertEqual(search.interval,300)
        for part in ({'origins':['ZZZ']},{'interval':30},{'interval':61},{'interval':420},{'checked_bags':3}):
            with self.subTest(part=part),self.assertRaises(ValueError):
                Search.model_validate(search.model_dump()|part)

    def test_dst_and_date_line_use_airport_timezones(self):
        self.assertEqual(local_instant('2026-07-05T12:00','JFK'),datetime(2026,7,5,16,tzinfo=timezone.utc))
        self.assertEqual(local_instant('2026-11-05T12:00','JFK'),datetime(2026,11,5,17,tzinfo=timezone.utc))
        departure=local_instant('2026-11-06T00:30','HND')
        arrival=local_instant('2026-11-05T17:00','LAX')
        self.assertEqual((arrival-departure).total_seconds()/60,570)

    def test_worldwide_airline_filter(self):
        leg=Leg(start='2026-11-05T00:00',end='2026-11-05T23:59',airlines=['ba'])
        flight={'departure':'2026-11-05T12:00','arrival':'2026-11-05T17:00','duration_minutes':600,'stops':0,'airlines':['British Airways'],'airline_codes':['BA']}
        self.assertTrue(eligible(flight,leg))
        flight['airline_codes']=['AA']
        self.assertFalse(eligible(flight,leg))

    def test_old_configs_receive_new_defaults_without_changing_user_fields(self):
        config=Search(origins=['THE'],destinations=['GRU'],outbound=Leg(start='2090-11-05T00:00',end='2090-11-05T23:59')).model_dump()
        config.pop('checked_bags')
        migrated=decode_search({'config':json.dumps(config),'version':7})
        self.assertEqual(migrated['config']['checked_bags'],0)
        self.assertEqual(migrated['version'],7)
        self.assertEqual(migrated['config']['origins'],['THE'])

    def test_bag_option_reaches_query_and_search_url(self):
        options={'origin':'LHR','destination':'JFK','date':'2026-11-05','cabin':'economy','adults':1,'checked_bags':1}
        with patch.object(collector,'create_query',wraps=collector.create_query) as create,patch.object(collector,'fetch_flights_html',side_effect=RuntimeError('stop before network')) as fetch_html:
            with self.assertRaisesRegex(RuntimeError,'stop before network'):
                collector.collect(options)
            self.assertEqual(create.call_args.kwargs['checked_bags'],1)
            bag_url=fetch_html.call_args.args[0].url()
        with patch.object(collector,'fetch_flights_html',side_effect=RuntimeError('stop')) as fetch_html:
            with self.assertRaises(RuntimeError):collector.collect(options|{'checked_bags':0})
            self.assertNotEqual(bag_url,fetch_html.call_args.args[0].url())

    def test_bag_option_reaches_collector_subprocess(self):
        search=Search(origins=['LHR'],destinations=['JFK'],outbound=Leg(start='2090-11-05T00:00',end='2090-11-05T23:59'),checked_bags=2)
        with patch('backend.engine.subprocess.run') as run:
            run.return_value.returncode=0
            run.return_value.stdout=json.dumps({'status':'empty','flights':[]})
            fetch(search,('outbound','LHR','JFK','2090-11-05'))
            self.assertEqual(json.loads(run.call_args.kwargs['input'])['checked_bags'],2)


class LANTests(unittest.TestCase):
    def test_lan_is_opt_in_and_subnet_is_restricted(self):
        with patch.dict(os.environ,{'RADAR_LAN_CIDR':''}):
            self.assertTrue(allowed_client('127.0.0.1'))
            self.assertFalse(allowed_client('192.168.3.10'))
        with patch.dict(os.environ,{'RADAR_LAN_CIDR':'192.168.3.0/24'}):
            self.assertTrue(allowed_client('192.168.3.10'))
            self.assertFalse(allowed_client('192.168.4.10'))
            self.assertFalse(allowed_client('8.8.8.8'))
            self.assertFalse(allowed_host('evil.example'))
            self.assertTrue(allowed_host('192.168.3.42'))

    def test_lan_http_and_mutation_origin_protection(self):
        from backend.app import app, TOKEN
        with patch.dict(os.environ,{'RADAR_LAN_CIDR':'192.168.3.0/24'}):
            client=TestClient(app,base_url='http://192.168.3.42:8765',client=('192.168.3.10',1234))
            try:
                self.assertEqual(client.get('/api/airports?q=JFK').status_code,200)
                self.assertEqual(client.post('/api/searches',json={}).status_code,403)
                self.assertEqual(client.post('/api/searches',json={},headers={'x-radar-token':TOKEN,'origin':'http://192.168.3.42:8765'}).status_code,422)
                self.assertEqual(client.post('/api/searches',json={},headers={'x-radar-token':TOKEN,'origin':'https://evil.example'}).status_code,403)
            finally:
                client.close()
            client=TestClient(app,base_url='http://192.168.3.42:8765',client=('192.168.4.10',1234))
            try:
                self.assertEqual(client.get('/api/airports?q=JFK').status_code,403)

            finally:
                client.close()


class CollectionReliabilityTests(unittest.TestCase):
    def test_saved_cadence_is_kept_without_route_failures(self):
        from backend.engine import next_collection_due
        for interval in (60,300,420,1800):
            for elapsed in (2,35,300,1200):
                due=next_collection_due(1000,1000+elapsed,interval)
                self.assertGreater(due,1000+elapsed)
                self.assertLessEqual(due-(1000+elapsed),interval)

    def group(self,items):
        from types import SimpleNamespace as NS
        class Group(list):pass
        group=Group(items);group.metadata=NS(airlines=[NS(name='British Airways',code='BA')]);return group

    def item(self,segments):
        from types import SimpleNamespace as NS
        def segment(origin,destination,start,end):
            return NS(from_airport=NS(code=origin),to_airport=NS(code=destination),departure=NS(date=[2026,11,5],time=[start,0]),arrival=NS(date=[2026,11,5],time=[end,0]))
        return NS(flights=[segment(*s) for s in segments],price=500,airlines=['British Airways'])

    def collect_fixture(self,items):
        from types import SimpleNamespace as NS
        group=self.group(items)
        # One raw itinerary (parse_js is replaced) and block 7 with the airline codes.
        script=NS(text=lambda:'data:'+json.dumps([None,None,[[1]],None,None,None,None,[None,[[],[['BA','British Airways']]]]])+',')
        parser=NS(css_first=lambda selector:script)
        with patch.object(collector,'fetch_flights_html',return_value='fixture'),patch.object(collector,'LexborHTMLParser',return_value=parser),patch.object(collector,'parse_js',return_value=group):
            return collector.collect({'origin':'LHR','destination':'JFK','date':'2026-11-05','cabin':'economy','adults':1})

    def test_unsupported_single_itinerary_does_not_discard_valid_flights(self):
        valid=self.item([('LHR','JFK',12,15)])
        transfer=self.item([('LHR','LGA',12,13),('EWR','JFK',14,15)])
        unknown=self.item([('LHR','ZZZ',12,13),('ZZZ','JFK',14,15)])
        result=self.collect_fixture([valid,transfer,unknown])
        self.assertEqual(result['status'],'ok')
        self.assertEqual(len(result['flights']),1)
        self.assertEqual(result['flights'][0]['duration_minutes'],480)
        self.assertEqual(result['skipped'],{'unsupported_itinerary':1,'unsupported_airport':1})

    def test_all_unverifiable_offers_are_an_error_not_no_flights(self):
        bad=self.item([('LHR','LGA',12,13),('EWR','JFK',14,15)])
        with self.assertRaisesRegex(ValueError,'validadas') as caught:
            self.collect_fixture([bad])
        # This query's offers only: the search backs off, the source is not paused for everyone.
        self.assertEqual(caught.exception.kind,'no_results')


class CurrencyLifecycleTests(unittest.TestCase):
    def config(self,**changes):
        return Search(origins=['THE'],destinations=['GRU'],outbound=Leg(start='2090-11-05T00:00',end='2090-11-05T23:59'),**changes)

    def test_currencies_are_validated_and_brl_remains_default(self):
        self.assertEqual(self.config().currency,'BRL')
        for currency in ('USD','EUR','COP','JPY'):
            self.assertEqual(self.config(currency=currency.lower()).currency,currency)
        with self.assertRaises(ValueError):self.config(currency='FAKE')

    def test_currency_is_sent_to_source_and_link_not_only_displayed(self):
        for currency in ('USD','EUR','COP'):
            options={'origin':'LHR','destination':'JFK','date':'2090-11-05','cabin':'economy','adults':1,'currency':currency}
            with patch.object(collector,'create_query',wraps=collector.create_query) as create,patch.object(collector,'fetch_flights_html',side_effect=RuntimeError('stop before network')) as html:
                with self.assertRaises(RuntimeError):collector.collect(options)
                self.assertEqual(create.call_args.kwargs['currency'],currency)
                self.assertIn('curr='+currency,html.call_args.args[0].url())
            with patch('backend.engine.subprocess.run') as run:
                run.return_value.returncode=0;run.return_value.stdout=json.dumps({'status':'empty','flights':[]})
                fetch(self.config(currency=currency),('outbound','THE','GRU','2090-11-05'))
                self.assertEqual(json.loads(run.call_args.kwargs['input'])['currency'],currency)

    def test_final_deadline_uses_return_and_origin_timezone(self):
        from backend.domain import monitoring_deadline
        config=self.config(inbound=Leg(start='2090-11-09T00:00',end='2090-11-09T23:59'))
        self.assertEqual(monitoring_deadline(config),local_instant(config.inbound.end,'GRU').timestamp())

    def test_alert_formats_currency_of_the_observed_flight(self):
        from backend.engine import money
        self.assertTrue(money(15000,'USD').startswith('USD '))
        self.assertTrue(money(15000,'COP').startswith('COP '))


class ConciseAlertTests(unittest.TestCase):
    def test_alert_is_short_actionable_and_localized(self):
        from backend.engine import event_text
        event={'kind':'lower_price','price_cents':110800,'previous':281500,'saving_cents':170700,'saving_percent':61,'flight':{'origin':'THE','destination':'CGH','departure':'2090-11-05T23:40','arrival':'2090-11-06T07:30','airlines':['LATAM'],'duration_minutes':470,'stops':1,'adults':1,'currency':'BRL','search_url':'https://example.org/flight'}}
        for language,word in [('pt','Economia'),('en','Save'),('es','Ahorro')]:
            body=event_text('São Paulo','outbound',event,language)
            self.assertLessEqual(len(body.splitlines()),12);self.assertIn('R$ 1,108.00' if language=='en' else 'R$ 1.108,00',body);self.assertIn(word,body);self.assertIn('61%',body);self.assertNotIn('https://example.org/flight',body)
            self.assertNotIn('Coletado em',body);self.assertNotIn('mesma janela',body)
