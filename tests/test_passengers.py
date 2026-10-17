"""Passenger categories reach the provider and retain truthful party pricing."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import json
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch
from pydantic import ValidationError
from backend import collector
from backend.domain import Search,Leg
from backend.engine import fetch,event_text


class PassengerTests(unittest.TestCase):
    def config(self,**values):
        return Search(origins=['LHR'],destinations=['JFK'],outbound=Leg(start='2090-11-05T00:00',end='2090-11-05T23:59'),**values)
    def test_default_migration_and_group_limits(self):
        search=self.config();self.assertEqual(search.children,0);self.assertEqual(search.infants_in_seat,0);self.assertEqual(search.infants_on_lap,0)
        self.assertEqual(self.config(adults=2,children=3,infants_in_seat=2,infants_on_lap=2).adults,2)
        for values in [{'adults':2,'children':8},{'infants_on_lap':2},{'children':-1},{'children':1.5},{'infants_in_seat':9},{'adults':0}]:
            with self.assertRaises(ValidationError):self.config(**values)
    def test_categories_reach_query_and_generate_distinct_offer_links(self):
        base={'origin':'LHR','destination':'JFK','date':'2090-11-05','cabin':'economy','adults':2}
        links=[]
        for values in [{},{'children':1},{'infants_in_seat':1},{'infants_on_lap':1}]:
            with patch.object(collector,'fetch_flights_html',side_effect=RuntimeError('no network')) as request,patch.object(collector,'create_query',wraps=collector.create_query) as create:
                with self.assertRaises(RuntimeError):collector.collect(base|values)
                party=create.call_args.kwargs['passengers'];self.assertEqual(party.children,values.get('children',0));self.assertEqual(party.infants_in_seat,values.get('infants_in_seat',0));self.assertEqual(party.infants_on_lap,values.get('infants_on_lap',0));links.append(request.call_args.args[0].url())
        self.assertEqual(len(set(links)),4)
    def test_categories_cross_subprocess_boundary(self):
        with patch('backend.engine.subprocess.run') as run:
            run.return_value=NS(returncode=0,stdout=json.dumps({'status':'empty','flights':[]}))
            fetch(self.config(adults=2,children=1,infants_in_seat=1,infants_on_lap=1),('outbound','LHR','JFK','2090-11-05'))
            options=json.loads(run.call_args.kwargs['input']);self.assertEqual([options[k] for k in ('adults','children','infants_in_seat','infants_on_lap')],[2,1,1,1])
    def test_collected_fare_keeps_party_total_and_passenger_counts(self):
        class Group(list):pass
        segment=NS(from_airport=NS(code='LHR'),to_airport=NS(code='JFK'),departure=NS(date=[2090,11,5],time=[12,0]),arrival=NS(date=[2090,11,5],time=[15,0]))
        group=Group([NS(flights=[segment],price=1500,airlines=['British Airways'])]);group.metadata=NS(airlines=[NS(name='British Airways',code='BA')])
        # One raw itinerary (parse_js is replaced) and block 7 with the airline codes.
        script=NS(text=lambda:'data:'+json.dumps([None,None,[[1]],None,None,None,None,[None,[[],[['BA','British Airways']]]]])+',');parser=NS(css_first=lambda _:script)
        with patch.object(collector,'fetch_flights_html',return_value='fixture'),patch.object(collector,'LexborHTMLParser',return_value=parser),patch.object(collector,'parse_js',return_value=group):
            result=collector.collect({'origin':'LHR','destination':'JFK','date':'2090-11-05','cabin':'economy','adults':2,'children':1,'infants_on_lap':1})
        flight=result['flights'][0];self.assertEqual(flight['price_cents'],150000);self.assertEqual(flight['price_scope'],'party_per_leg');self.assertEqual(flight['children'],1);self.assertEqual(flight['infants_on_lap'],1)
        event={'kind':'target','price_cents':150000,'flight':flight}
        for language,phrase in [('pt','4 passageiros'),('en','4 passengers'),('es','4 pasajeros')]:
            text=event_text('Family','outbound',event,language);self.assertIn(phrase,text);self.assertNotIn('2 adulto(s)',text);self.assertLessEqual(len(text.splitlines()),11)
