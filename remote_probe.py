"""Opt-in, bounded system queries sent through SSH stdin, without remote files."""


BEGIN = '__ORBIT_SYSTEM_V1__'
END = '__ORBIT_SYSTEM_END__'


def probe_script(item):
    # Only fixed commands are transmitted. Host and display labels never enter the script.
    script = r'''
export LC_ALL=C
printf '\n__ORBIT_SYSTEM_V1__\n'
printf 'hostname\t'; hostname 2>/dev/null
if [ -r /proc/uptime ]; then printf 'addresses\t'; hostname -I 2>/dev/null; fi
printf 'os\t'; uname -srm 2>/dev/null
if [ -r /proc/uptime ]; then awk '{printf "uptime\t%.0f seconds\n", $1}' /proc/uptime; fi
if [ -r /proc/meminfo ]; then awk '/^MemTotal:/ {t=$2} /^MemAvailable:/ {a=$2} END {if(t>0) printf "ram\t%.0f\t%.0f\n",t*1024,a*1024}' /proc/meminfo; fi
df -Pk "$HOME" 2>/dev/null | awk 'NR==2 {printf "disk\t%s\t%s\t%s\n", $2,$3,$4}'
'''
    if item.get('probe_services'):
        script += r'''
if command -v systemctl >/dev/null 2>&1; then
 systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | awk 'NR<=200 {printf "service\t%s\tactive\n",$1} NR==201 {print "notice\tService list limited to 200 entries"}'
else printf 'notice\tService queries require systemd on this server\n'; fi
'''
    if item.get('probe_ports'):
        script += r'''
if command -v ss >/dev/null 2>&1; then
 ss -H -lntu 2>/dev/null | awk 'NR<=200 {printf "port\t%s %s\tlistening locally\n",$1,$5} NR==201 {print "notice\tPort list limited to 200 entries"}'
else printf 'notice\tPort queries require ss on this server\n'; fi
'''
    return script + "printf '__ORBIT_SYSTEM_END__\\n'\n"


def parse_probe(output):
    if output.count(BEGIN) != 1 or output.count(END) != 1:
        raise ValueError('Incomplete automatic SSH response')
    payload = output.split(BEGIN, 1)[1].split(END, 1)[0]
    sections = {'SYSTEM': [], 'SPEICHER': []}
    warnings = []
    disk = None
    memory = None
    for line in payload.splitlines()[:1000]:
        fields = line.split('\t')
        key = fields[0]
        if key in ('hostname', 'os', 'uptime', 'addresses') and len(fields) == 2 and fields[1]:
            label = {'hostname': 'Hostname', 'os': 'Operating system', 'uptime': 'Uptime', 'addresses': 'IP addresses'}[key]
            sections['SYSTEM'].append({'label': label, 'value': fields[1][:500]})
        elif key == 'ram' and len(fields) == 3:
            total, available = map(int, fields[1:])
            if total <= 0 or not 0 <= available <= total:
                raise ValueError('Invalid memory values')
            memory = {'total': total, 'used': total - available, 'available': available}
            sections['SYSTEM'].append({'label': 'RAM', 'value': f'{(total-available)/2**30:.1f} / {total/2**30:.1f} GiB used'})
        elif key == 'disk' and len(fields) == 4:
            total, used, free = [int(x)*1024 for x in fields[1:]]
            if total <= 0 or min(used, free) < 0 or used > total:
                raise ValueError('Invalid disk values')
            disk = {'total': total, 'used': used, 'free': free}
            sections['SPEICHER'] = [{'label': 'Home-Dateisystem', 'value': f'{used/2**30:.1f} / {total/2**30:.1f} GiB used ({round(used/total*100)} %)'},
                                   {'label': 'Freier Platz', 'value': f'{free/2**30:.1f} GiB'}]
        elif key in ('service', 'port') and len(fields) == 3:
            sections.setdefault('DIENSTE' if key == 'service' else 'PORTS', []).append({'label': fields[1][:500], 'value': fields[2][:500]})
        elif key == 'notice' and len(fields) == 2:
            warnings.append(fields[1][:500])
    if not sections['SYSTEM']:
        raise ValueError('No usable system values')
    if not disk:
        warnings.append('Home filesystem data unavailable')
    if not any(row['label'] == 'RAM' for row in sections['SYSTEM']):
        warnings.append('RAM data unavailable; automatic RAM queries currently require Linux')
    return {'sections': sections, 'warnings': warnings, 'disk': disk, 'memory': memory}
