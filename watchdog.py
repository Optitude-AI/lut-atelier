import subprocess
import time
import os
import signal
import socket

def is_port_open(port=3000):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(1)
        result = s.connect_ex(('127.0.0.1', port))
        s.close()
        return result == 0
    except:
        return False

def start_server():
    try:
        proc = subprocess.Popen(
            ['node', 'server.js', '-p', '3000'],
            cwd='/home/z/my-project/.next/standalone',
            stdout=open('/home/z/my-project/dev.log', 'a'),
            stderr=subprocess.STDOUT,
            preexec_fn=os.setsid
        )
        return proc
    except Exception as e:
        with open('/home/z/my-project/watchdog.log', 'a') as f:
            f.write(f"Failed to start: {e}\n")
        return None

def main():
    os.chdir('/home/z/my-project/.next/standalone')
    
    while True:
        if not is_port_open(3000):
            with open('/home/z/my-project/watchdog.log', 'a') as f:
                f.write(f"[{time.strftime('%H:%M:%S')}] Port 3000 down, restarting...\n")
            
            # Kill any stale processes
            try:
                subprocess.run(['fuser', '-k', '3000/tcp'], capture_output=True, timeout=5)
            except:
                pass
            time.sleep(1)
            
            start_server()
            # Wait for server to be ready
            for _ in range(15):
                if is_port_open(3000):
                    with open('/home/z/my-project/watchdog.log', 'a') as f:
                        f.write(f"[{time.strftime('%H:%M:%S')}] Server ready\n")
                    break
                time.sleep(1)
        
        time.sleep(2)

if __name__ == '__main__':
    main()
