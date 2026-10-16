import type {State} from './types';
// Server timestamps are paired with the receipt time; device clock offset is irrelevant.
export function reusableRevision(previous:State|undefined,receivedAt:number,now=Date.now()):string|undefined {
  if(!previous?.revision)return undefined;
  const serverNow=previous.server_time+Math.max(0,now-receivedAt)/1000;
  if(previous.quote_expires && serverNow>=previous.quote_expires)return undefined;
  return previous.revision;
}
