"""Battle overlays have their own audited link deltas, separate from field code."""
import re

def port_address(address, profile):
    if 0x02199900 <= address < 0x021f4300:
        return address - (0x40 if profile == 'black2' else 0x100 if profile == 'white2italy' else 0)
    if profile == 'black2':
        from black2_port import port_address as translate
        return translate(address)
    if profile == 'white2italy':
        from italy_port import port_address as translate
        return translate(address)
    return address

def port_source(text, profile):
    return re.sub(r'0x0?2[0-9a-fA-F]{6}',lambda m:f'0x{port_address(int(m.group(),16),profile):08x}',text)
