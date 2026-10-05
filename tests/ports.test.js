const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseEndpoint, parseNetstat, assembleSnapshot, localhostUrl } = require('../src/ports');

test('reads listening TCP and bound UDP ports; excludes outgoing connections', () => {
  const rows = parseNetstat(`
  TCP    0.0.0.0:5173    0.0.0.0:0       LISTENING       1234
  TCP    [::]:5173       [::]:0          LISTENING       1234
  TCP    127.0.0.1:50321 127.0.0.1:5173  ESTABLISHED     8000
  UDP    [::1]:5353      *:*                            4321
  UDP    0.0.0.0:5000    *:*                            4321
  nonsense
  `);
  assert.equal(rows.length,4);
  assert.deepEqual(rows[1],{address:'::',port:5173,pid:1234,protocol:'TCP'});
  assert.deepEqual(rows[2],{address:'::1',port:5353,pid:4321,protocol:'UDP'});
  assert.equal(parseEndpoint('invalid'),null);
});

const makeProcess = (pid,name,overrides={}) => ({pid,name,path:`C:\\Apps\\${name}.exe`,command:'',identity:'12345',startedAt:'2026-10-05T10:00:00Z',memoryBytes:1000,parentPid:0,...overrides});
test('merges dual-stack endpoints and protects Windows, own process and parents', () => {
  const endpoints = [
    {protocol:'TCP',port:5173,pid:10,address:'0.0.0.0'},
    {protocol:'TCP',port:5173,pid:10,address:'::'},
    {protocol:'TCP',port:135,pid:4,address:'0.0.0.0'},
    {protocol:'TCP',port:9000,pid:11,address:'127.0.0.1'},
    {protocol:'TCP',port:9001,pid:12,address:'127.0.0.1'},
    {protocol:'TCP',port:9002,pid:13,address:'127.0.0.1'},
  ];
  const processes = [makeProcess(10,'node'), makeProcess(11,'Portlight',{parentPid:12}), makeProcess(12,'terminal'),makeProcess(13,'unknown',{identity:null})];
  const rows = assembleSnapshot(endpoints,processes,11,'C:\\Apps\\Portlight.exe');
  assert.equal(rows.length,5);
  assert.deepEqual(rows.find(r=>r.pid===10).addresses,['0.0.0.0','::']);
  assert.equal(rows.find(r=>r.pid===10).developer,true);
  assert.equal(rows.find(r=>r.pid===10).protectedReason,'');
  assert.match(rows.find(r=>r.pid===4).protectedReason,/Windows/);
  assert.match(rows.find(r=>r.pid===11).protectedReason,/Portlight/);
  assert.match(rows.find(r=>r.pid===12).protectedReason,/parent/);
  assert.match(rows.find(r=>r.pid===13).protectedReason,/unavailable/);
});
test('constructs localhost URLs for wildcard, loopback and specific address binds', () => {
  assert.equal(localhostUrl({protocol:'TCP',port:3000,addresses:['::']}),'http://localhost:3000');
  assert.equal(localhostUrl({protocol:'TCP',port:3000,addresses:['::1']}),'http://[::1]:3000');
  assert.equal(localhostUrl({protocol:'TCP',port:3000,addresses:['192.168.1.2']}),'http://192.168.1.2:3000');
  assert.throws(()=>localhostUrl({protocol:'UDP',port:3000,addresses:['0.0.0.0']}),/UDP/);
});
