import {useState} from 'react';
import {Plane} from 'lucide-react';
export function AirlineLogo({code,name}:{code?:string;name:string}) {
 const [failed,setFailed]=useState(false);
 return <span className="carrier-logo" role="img" aria-label={name}>{code&&/^[A-Z0-9]{2,3}$/.test(code)&&!failed ? <img src={`/api/airline-logo/${code}`} width="36" height="36" loading="lazy" decoding="async" alt="" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/> : <Plane size={23} aria-hidden="true"/>}</span>;
}
