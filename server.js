'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const Busboy = require('busboy');
const { randomUUID } = require('node:crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { WebSocketServer, WebSocket } = require('ws');
const auth = require('./auth');
const PORT = Number(process.env.PORT || 8080);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
const MAX_CONNECTIONS_PER_IP = Number(process.env.MAX_CONNECTIONS_PER_IP || 5);
const MAX_MESSAGES_PER_MINUTE = Number(process.env.MAX_MESSAGES_PER_MINUTE || 120);
const rooms = new Map();
const R2_BUCKET = process.env.R2_BUCKET_NAME || '';
const r2Ready = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && R2_BUCKET);
const r2 = r2Ready ? new S3Client({ region: 'auto', endpoint: 'https://' + process.env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com', credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } }) : null;
const MEDIA_TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm','audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/webm','audio/aac','audio/ogg']);
function mediaConfigError(res) { return json(res,503,{error:'Cloudflare R2 is not configured. Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME to Render.'}); }
function readJson(req, limit, callback) { let body=''; req.on('data',chunk=>{ body+=chunk; if(body.length>limit){ req.destroy(); } }); req.on('end',()=>{ try { callback(JSON.parse(body||'{}')); } catch { json(res,400,{error:'Invalid request.'}); } }); }
async function mediaPresign(req,res) {
  if(!originAllowed(req)) return json(res,403,{error:'Origin not allowed'}); if(!r2Ready) return mediaConfigError(res);
  let body=''; req.on('data',chunk=>{body+=chunk;if(body.length>8192)req.destroy();});
  req.on('end',async()=>{ try {
    const data=JSON.parse(body||'{}'); const type=String(data.type||'').toLowerCase(); const size=Number(data.size);
    if(!MEDIA_TYPES.has(type)) return json(res,415,{error:'This media format is not supported.'});
    if(!Number.isFinite(size)||size<=0||size>250*1024*1024) return json(res,413,{error:'File must be no larger than 250 MB.'});
    const key='uploads/'+new Date().toISOString().slice(0,10)+'/'+randomUUID();
    const putUrl=await getSignedUrl(r2,new PutObjectCommand({Bucket:R2_BUCKET,Key:key,ContentType:type}),{expiresIn:900});
    return json(res,200,{key,putUrl,expiresIn:900});
  } catch { return json(res,400,{error:'Could not prepare this upload.'}); } });
}
async function mediaShare(req,res) {
  if(!originAllowed(req)) return json(res,403,{error:'Origin not allowed'}); if(!r2Ready) return mediaConfigError(res);
  let body=''; req.on('data',chunk=>{body+=chunk;if(body.length>4096)req.destroy();});
  req.on('end',async()=>{ try { const data=JSON.parse(body||'{}'); const key=String(data.key||'');
    if(!/^uploads\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[0-9a-f-]{36}$/.test(key)) return json(res,400,{error:'Invalid media reference.'});
    const url=await getSignedUrl(r2,new GetObjectCommand({Bucket:R2_BUCKET,Key:key}),{expiresIn:604800}); return json(res,200,{url,expiresIn:604800});
  } catch { return json(res,400,{error:'Could not create a share link.'}); } });
}
const socketsByIp = new Map();
const aiRequestsByIp = new Map();
const iceServers = [{ urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map(x => x.trim()).filter(Boolean) }];
if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) iceServers.push({ urls: process.env.TURN_URL.split(',').map(x => x.trim()), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
const originAllowed = req => { const origin=req.headers.origin; if(!origin)return false; if(ALLOWED_ORIGINS.length)return ALLOWED_ORIGINS.includes(origin); return origin===`https://${req.headers.host}`; };
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const json=(res,status,body,extra={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...extra});res.end(JSON.stringify(body));};
function editImage(req,res){
  if(!originAllowed(req))return json(res,403,{error:'Origin not allowed'});
  if(!process.env.OPENAI_API_KEY)return json(res,503,{error:'AI image editing is not configured. Add OPENAI_API_KEY to the Render service environment variables.'});
  const ip=req.socket.remoteAddress||'unknown'; const now=Date.now(); const recent=(aiRequestsByIp.get(ip)||[]).filter(t=>now-t<60_000); if(recent.length>=3)return json(res,429,{error:'Too many AI edit requests. Please wait a minute and try again.'}); recent.push(now); aiRequestsByIp.set(ip,recent);
  const contentType=req.headers['content-type']||''; if(!contentType.startsWith('multipart/form-data'))return json(res,400,{error:'Upload an image using multipart form data.'});
  let prompt='', image=null, imageMime='', fileBytes=0, failed=false;
  const bb=Busboy({headers:req.headers,limits:{fileSize:10*1024*1024,files:1,fields:2,fieldSize:3000}});
  bb.on('field',(name,value)=>{if(name==='prompt')prompt=value.trim();});
  bb.on('file',(name,stream,info)=>{if(name!=='image'){stream.resume();return;} imageMime=info.mimeType; const chunks=[]; stream.on('data',chunk=>{fileBytes+=chunk.length;chunks.push(chunk);}); stream.on('limit',()=>{failed=true;}); stream.on('end',()=>{image=Buffer.concat(chunks);});});
  bb.on('error',()=>{failed=true;});
  bb.on('close',async()=>{
    if(failed)return json(res,413,{error:'Image upload exceeded the 10 MB limit or could not be read.'});
    if(!image||!image.length)return json(res,400,{error:'No image was uploaded.'});
    if(!['image/jpeg','image/png','image/webp'].includes(imageMime))return json(res,415,{error:'Only JPG, PNG, and WEBP images are supported.'});
    if(!prompt||prompt.length>2000)return json(res,400,{error:'Enter an edit description of up to 2,000 characters.'});
    try{
      const form=new FormData(); form.append('model',process.env.OPENAI_IMAGE_MODEL||'gpt-image-2.5-sunburst');
      form.append('prompt',`Edit the supplied photograph according to this request: ${prompt}\nPreserve the identity and natural appearance of the subject unless the request explicitly asks to change them. Keep the result realistic, anatomically plausible, and respectful. Do not add text or watermarks.`);
      form.append('size','auto'); form.append('quality','medium'); form.append('output_format','png');
      form.append('image',new Blob([image],{type:imageMime}),imageMime==='image/png'?'source.png':imageMime==='image/webp'?'source.webp':'source.jpg');
      const upstream=await fetch('https://api.openai.com/v1/images/edits',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:form,signal:AbortSignal.timeout(180000)});
      const payload=await upstream.json().catch(()=>({}));
      if(!upstream.ok){const message=payload?.error?.message||`AI provider returned HTTP ${upstream.status}`; return json(res,502,{error:message.slice(0,500)});}
      const encoded=payload?.data?.[0]?.b64_json; if(!encoded)return json(res,502,{error:'AI provider returned no image data.'});
      return json(res,200,{image:`data:image/png;base64,${encoded}`,revisedPrompt:payload.data[0].revised_prompt||null});
    }catch(err){return json(res,502,{error:err.name==='TimeoutError'?'AI image editing timed out. Try a smaller image or try again.':'Could not reach the AI image service. Please try again.'});}
  });
  req.pipe(bb);
}
const server=http.createServer(async(req,res)=>{
  if(await auth.handle(req,res))return;
  const pathnameForAuth=(()=>{try{return new URL(req.url,'https://bharul.invalid').pathname;}catch{return '';}})();
  const publicPaths=new Set(['/login.html','/login.css','/login.js']);
  if(pathnameForAuth!=='/health'&&!publicPaths.has(pathnameForAuth)&&!auth.session(req)){
    if(req.method==='GET'||req.method==='HEAD'){res.writeHead(302,{Location:'/login.html','Cache-Control':'no-store'});return res.end();}
    return json(res,401,{error:'Sign in required.'});
  }
  if(req.method==='GET'&&req.url==='/health')return json(res,200,{ok:true,service:'bharul-signaling',aiImageEditing:!!process.env.OPENAI_API_KEY,mediaStorage:r2Ready?'cloudflare-r2':'not-configured'});
  if(req.method==='POST'&&req.url==='/ai/edit-image')return editImage(req,res);
  if(req.method==='POST'&&req.url==='/media/presign')return mediaPresign(req,res);
  if(req.method==='POST'&&req.url==='/media/share')return mediaShare(req,res);
  if(req.method==='GET'&&req.url==='/ice-config'){if(!originAllowed(req))return json(res,403,{error:'Origin not allowed'});return json(res,200,{iceServers},{'access-control-allow-origin':req.headers.origin,vary:'Origin'});}
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'},{allow:'GET, POST'});
  let pathname;try{pathname=new URL(req.url,'http://localhost').pathname;}catch{return json(res,400,{error:'Invalid URL'});}
  let requested;try{requested=pathname==='/'?'/index.html':decodeURIComponent(pathname);}catch{return json(res,400,{error:'Invalid path'});}
  const file=path.resolve(__dirname,'.'+requested);if(!file.startsWith(path.resolve(__dirname)+path.sep))return json(res,400,{error:'Invalid path'});
  fs.stat(file,(err,stat)=>{if(err||!stat.isFile())return json(res,404,{error:'Not found'});res.writeHead(200,{'content-type':MIME[path.extname(file)]||'application/octet-stream','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','cache-control':path.basename(file)==='index.html'||path.basename(file)==='config.js'?'no-store':'public, max-age=3600'});fs.createReadStream(file).pipe(res);});
});
const wss=new WebSocketServer({noServer:true,maxPayload:16*1024,perMessageDeflate:false});
server.on('upgrade',(req,socket,head)=>{if(!auth.session(req)){socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();return;}if(!originAllowed(req)){socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;}const ip=req.socket.remoteAddress||'unknown';if((socketsByIp.get(ip)||0)>=MAX_CONNECTIONS_PER_IP){socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');socket.destroy();return;}if(new URL(req.url,'http://localhost').pathname!=='/signal'){socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>{ws.clientIp=ip;wss.emit('connection',ws,req);});});
function send(ws,data){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));}
function leave(ws){const room=ws.room;if(!room)return;const peers=rooms.get(room);if(peers){peers.delete(ws);for(const peer of peers)send(peer,{type:'peer-left'});if(!peers.size)rooms.delete(room);}ws.room=null;}
function closeWith(ws,code,reason){try{ws.close(code,reason);}catch{}}
wss.on('connection',ws=>{const ip=ws.clientIp;socketsByIp.set(ip,(socketsByIp.get(ip)||0)+1);ws.messageTimes=[];ws.on('message',raw=>{const now=Date.now();ws.messageTimes=ws.messageTimes.filter(t=>now-t<60000);if(ws.messageTimes.length>=MAX_MESSAGES_PER_MINUTE)return closeWith(ws,1008,'Rate limit exceeded');ws.messageTimes.push(now);let msg;try{msg=JSON.parse(raw.toString());}catch{return send(ws,{type:'error',message:'Invalid message'});}if(!msg||typeof msg!=='object'||Array.isArray(msg)||typeof msg.type!=='string')return send(ws,{type:'error',message:'Invalid message format'});if(msg.type==='join'){const room=String(msg.room||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40);if(room.length<6)return send(ws,{type:'error',message:'Room code must contain at least 6 valid characters'});if(ws.room&&ws.room!==room)leave(ws);let peers=rooms.get(room);if(!peers){peers=new Set();rooms.set(room,peers);}if(peers.has(ws))return;if(peers.size>=2)return send(ws,{type:'room-full'});ws.room=room;peers.add(ws);for(const peer of peers)if(peer!==ws)send(peer,{type:'peer-joined'});send(ws,{type:'joined',participants:peers.size});return;}if(msg.type==='leave'){leave(ws);return;}if(!ws.room)return send(ws,{type:'error',message:'Join a room first'});const allowed=new Set(['offer','answer','ice-candidate']);if(!allowed.has(msg.type))return send(ws,{type:'error',message:'Unsupported signaling message'});const peers=rooms.get(ws.room)||new Set();const payload={type:msg.type};if(msg.type==='offer'||msg.type==='answer'){if(!msg.description||typeof msg.description!=='object'||typeof msg.description.sdp!=='string'||msg.description.sdp.length>12000)return send(ws,{type:'error',message:'Invalid session description'});payload.description={type:msg.description.type,sdp:msg.description.sdp};}else{if(!msg.candidate||typeof msg.candidate!=='object'||typeof msg.candidate.candidate!=='string'||msg.candidate.candidate.length>4000)return send(ws,{type:'error',message:'Invalid ICE candidate'});payload.candidate=msg.candidate;}for(const peer of peers)if(peer!==ws)send(peer,payload);});ws.on('close',()=>{leave(ws);const n=(socketsByIp.get(ip)||1)-1;if(n<=0)socketsByIp.delete(ip);else socketsByIp.set(ip,n);});ws.on('error',()=>leave(ws));});
server.listen(PORT,'0.0.0.0',()=>console.log(`Bharul web app, AI image edit and signaling listening on ${PORT}`));
