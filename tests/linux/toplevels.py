"""Read mapped titles using the standard ext-foreign-toplevel-list Wayland protocol.

Reference: wayland-protocols/staging/ext-foreign-toplevel-list-v1.xml.
This small read-only probe avoids a compositor-specific window-manager API.
"""
import os
from pathlib import Path
import socket
import struct

def titles():
    display = Path(os.environ['WAYLAND_DISPLAY'])
    if not display.is_absolute(): display = Path(os.environ['XDG_RUNTIME_DIR']) / display
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(3)
        client.connect(str(display))
        buffer = bytearray()
        def send(obj, opcode, data):
            client.sendall(struct.pack('=II',obj,((len(data)+8)<<16)|opcode)+data)
        def messages():
            def receive():
                data = client.recv(65536)
                if not data: raise EOFError('Compositor disconnected during the window check')
                buffer.extend(data)
            while True:
                while len(buffer)<8: receive()
                obj, header = struct.unpack_from('=II',buffer)
                length, opcode = header>>16, header&0xffff
                if length<8: raise RuntimeError('Invalid Wayland message')
                while len(buffer)<length: receive()
                data=bytes(buffer[8:length]);del buffer[:length]
                yield obj,opcode,data
        def string(data, offset=0):
            size=struct.unpack_from('=I',data,offset)[0]
            return data[offset+4:offset+4+size-1].decode(),offset+4+((size+3)//4)*4
        send(1,1,struct.pack('=I',2))  # wl_display.get_registry
        send(1,0,struct.pack('=I',3))  # wl_display.sync
        global_id=None
        stream=messages()
        for obj,opcode,data in stream:
            if obj==2 and opcode==0:
                interface,_=string(data,4)
                if interface=='ext_foreign_toplevel_list_v1': global_id=struct.unpack_from('=I',data)[0]
            if obj==3: break
        if global_id is None: raise RuntimeError('Compositor does not expose ext_foreign_toplevel_list_v1')
        name=b'ext_foreign_toplevel_list_v1\0'
        send(2,0,struct.pack('=II',global_id,len(name))+name+b'\0'*((-len(name))%4)+struct.pack('=II',1,4))
        send(1,0,struct.pack('=I',5))
        handles=set();result=[]
        for obj,opcode,data in stream:
            if obj==4 and opcode==0: handles.add(struct.unpack_from('=I',data)[0])
            if obj in handles and opcode==2: result.append(string(data)[0])
            if obj==5: break
        return result

if __name__=='__main__':
    print('\n'.join(titles()))
