"""Opt-in trusted LAN access; loopback is always permitted."""
import os
from ipaddress import ip_address, ip_network


def lan_network():
    value = os.environ.get("RADAR_LAN_CIDR", "").strip()
    if not value:
        return None
    network = ip_network(value, strict=True)
    if network.version != 4 or not network.is_private or network.prefixlen < 24:
        raise ValueError("RADAR_LAN_CIDR deve ser uma sub-rede IPv4 privada /24 ou menor")
    return network


def allowed_client(address):
    try:
        address = ip_address(address)
    except ValueError:
        return False
    network = lan_network()
    return address.is_loopback or bool(network and address in network)


def allowed_host(hostname):
    if hostname == "localhost":
        return True
    return allowed_client(hostname or "")


def public_mode():
    value=os.environ.get('RADAR_DEPLOYMENT','local')
    if value not in ('local','public'):
        raise ValueError('RADAR_DEPLOYMENT deve ser local ou public')
    return value=='public'


def public_origin():
    """Fail closed: public deployments require one explicit HTTPS origin."""
    import re
    from urllib.parse import urlsplit
    value=os.environ.get('RADAR_PUBLIC_URL','').rstrip('/')
    parsed=urlsplit(value)
    if (parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password
        or parsed.path or parsed.query or parsed.fragment
        or not re.fullmatch(r'[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+',parsed.hostname)):
        raise ValueError('RADAR_PUBLIC_URL deve ser uma origem HTTPS com domínio, sem caminho')
    try:
        ip_address(parsed.hostname)
    except ValueError:
        pass
    else:
        raise ValueError('Use um domínio HTTPS na implantação pública')
    # Validate ports rather than accepting a malformed Host later.
    port=parsed.port or 443
    return 'https://'+parsed.hostname.lower()+((':'+str(port)) if port!=443 else '')


def public_request_allowed(request):
    from urllib.parse import urlsplit
    # Container health checks never expose application routes over plaintext HTTP.
    if request.url.path=='/api/health' and request.client:
        try:
            if ip_address(request.client.host).is_loopback and request.url.hostname in ('127.0.0.1','localhost'):
                return True
        except ValueError:pass
    try:
        host=urlsplit('https://'+request.headers.get('host',''))
        if host.username or host.password or host.path or host.query or host.fragment:return False
        incoming='https://'+(host.hostname or '').lower()+((':'+str(host.port)) if host.port and host.port!=443 else '')
        return request.url.scheme=='https' and incoming==public_origin()
    except ValueError:
        return False
