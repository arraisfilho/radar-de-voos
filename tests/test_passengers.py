"""Passenger categories reach the provider and retain truthful party pricing."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import base64
import json
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch
from urllib.parse import parse_qs,urlsplit
from fast_flights.pb.flights_pb2 import Info
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
    def collected(self,**values):
        """One fare through the results page (parse_js replaced): the flight and the query fetched."""
        class Group(list):pass
        segment=NS(from_airport=NS(code='LHR'),to_airport=NS(code='JFK'),departure=NS(date=[2090,11,5],time=[12,0]),arrival=NS(date=[2090,11,5],time=[15,0]))
        group=Group([NS(flights=[segment],price=1500,airlines=['British Airways'])]);group.metadata=NS(airlines=[NS(name='British Airways',code='BA')])
        # One raw itinerary and block 7 with the airline codes.
        script=NS(text=lambda:'data:'+json.dumps([None,None,[[1]],None,None,None,None,[None,[[],[['BA','British Airways']]]]])+',');parser=NS(css_first=lambda _:script)
        with patch.object(collector,'fetch_flights_html',return_value='fixture') as page,patch.object(collector,'LexborHTMLParser',return_value=parser),patch.object(collector,'parse_js',return_value=group):
            result=collector.collect({'origin':'LHR','destination':'JFK','date':'2090-11-05','cabin':'economy','adults':2}|values)
        return result['flights'][0],page.call_args.args[0]
    def test_estimated_parties_fetch_adults_and_link_the_real_party(self):
        codes=lambda url:list(Info.FromString(base64.b64decode(parse_qs(urlsplit(url).query)['tfs'][0])).passengers)
        links=[]
        for values,adults in [({},2),({'children':1},3),({'infants_in_seat':1},3),({'infants_on_lap':1},2),({'children':1,'infants_in_seat':2,'infants_on_lap':1},5)]:
            with self.subTest(values=values):
                flight,fetched=self.collected(**values)
                # The page prices adults only: children and infants in seat are queried as adults, infants on lap left out.
                self.assertEqual(list(fetched.passengers),[1]*adults)
                self.assertEqual([flight[k] for k in ('adults','children','infants_in_seat','infants_on_lap')],[2,values.get('children',0),values.get('infants_in_seat',0),values.get('infants_on_lap',0)])
                self.assertEqual(flight['search_url']==fetched.url(),not values);links.append(flight['search_url'])
        self.assertEqual(len(set(links)),5)
        # The link has the real party; Google reads 3 as on lap and 4 as in seat (fast-flights 3.1.0 writes the opposite).
        self.assertEqual(codes(links[0]),[1,1]);self.assertEqual(codes(links[2]),[1,1,4]);self.assertEqual(codes(links[3]),[1,1,3])
        self.assertEqual(sorted(codes(links[4])),[1,1,2,3,4,4])
    def test_categories_cross_subprocess_boundary(self):
        with patch('backend.engine.subprocess.Popen') as popen:
            popen.return_value.returncode=0;popen.return_value.communicate.return_value=(json.dumps({'status':'empty','flights':[]}),'')
            fetch(self.config(adults=2,children=1,infants_in_seat=1,infants_on_lap=1),('outbound','LHR','JFK','2090-11-05'))
            options=json.loads(popen.return_value.communicate.call_args.args[0]);self.assertEqual([options[k] for k in ('adults','children','infants_in_seat','infants_on_lap')],[2,1,1,1])
    def test_collected_fare_keeps_party_total_and_passenger_counts(self):
        flight,_=self.collected(children=1,infants_on_lap=1)
        self.assertEqual(flight['price_cents'],150000);self.assertEqual(flight['price_scope'],'party_per_leg');self.assertEqual(flight['children'],1);self.assertEqual(flight['infants_on_lap'],1)
        event={'kind':'target','price_cents':150000,'flight':flight}
        for language,phrase,estimate in [('pt','4 passageiros','Preço estimado para 3 adultos.'),('en','4 passengers','Estimated price for 3 adults.'),('es','4 pasajeros','Precio estimado para 3 adultos.')]:
            # One line more than an adults-only alert: the estimate.
            text=event_text('Family','outbound',event,language);self.assertIn(phrase,text);self.assertIn(estimate,text.splitlines());self.assertNotIn('2 adulto(s)',text);self.assertLessEqual(len(text.splitlines()),12)
