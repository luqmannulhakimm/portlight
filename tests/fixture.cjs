const http = require('node:http');
const dgram = require('node:dgram');
const servers = [];
const ports = {};
const bindHttp = (host,key) => new Promise((resolve,reject)=>{
  const server=http.createServer((req,res)=>res.end('Portlight test server'));
  servers.push(server); server.on('error',reject);
  server.listen(0,host,()=>{ports[key]=server.address().port;resolve();});
});
(async()=>{
  await bindHttp('127.0.0.1','tcp');
  await bindHttp('::1','ipv6');
  const udp=dgram.createSocket('udp4'); servers.push(udp);
  await new Promise(resolve=>udp.bind(0,'127.0.0.1',resolve)); ports.udp=udp.address().port;
  process.stdout.write(JSON.stringify({...ports,pid:process.pid})+'\n');
})().catch(error=>{console.error(error);process.exit(1)});
