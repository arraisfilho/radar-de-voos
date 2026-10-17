"""Bound aggregate traffic, with FIFO admission and one active request per account."""
import threading
import time
from contextlib import contextmanager

class Stopped(RuntimeError):
    """The monitor stopped while this query waited for a slot."""

class QueryGate:
    def __init__(self,concurrency=2,min_gap=5.0):
        self.concurrency=concurrency;self.min_gap=min_gap
        self.condition=threading.Condition();self.waiting=[];self.active=set();self.next_start=0

    @contextmanager
    def slot(self,owner,stop_event):
        ticket=object()
        with self.condition:
            self.waiting.append((ticket,owner))
            try:
                while True:
                    if stop_event.is_set():raise Stopped('collector stopped')
                    eligible=next((token for token,account in self.waiting if account not in self.active),None)
                    if eligible is ticket and len(self.active)<self.concurrency and time.monotonic()>=self.next_start:
                        self.waiting.remove((ticket,owner));self.active.add(owner)
                        self.next_start=time.monotonic()+self.min_gap
                        break
                    self.condition.wait(timeout=.2)
            except BaseException:
                self.waiting.remove((ticket,owner));self.condition.notify_all();raise
        try:yield
        finally:
            with self.condition:self.active.remove(owner);self.condition.notify_all()
