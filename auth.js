'use strict';
const {OAuth2Client}=require('google-auth-library');
const {createHmac,randomBytes,timingSafeEqual}=require('node:crypto');
const ALLOWED_EMAIL='Danwalton00@gmail.com'.toLowerCase();
const COOKIE='bharul_session', STATE_COOKIE='bharul_oauth_state';
const configured=()=>!!(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.SESSION_SECRET&&process.env.SESSION_SECRET.length>=32);
const redirectUri=req=>process.env.GOOGLE_REDIRECT_URI||('https://'+req.headers.host+'/auth/callback');
function client(req){return new OAuth2Client(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,redirectUri(req));}
function cookie(req,name){const item=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));return item?decodeURIComponent(item.slice(name.length+1)):'';}
function sign(value){return createHmac('sha256',process.env.SESSION_SECRET).update(value).digest('base64url');}
function safeEqual(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function session(req){if(!configured())return false;const raw=cookie(req,COOKIE);const dot=raw.lastIndexOf('.');if(dot<1)return false;const payload=raw.slice(0,dot),sig=raw.slice(dot+1);if(!safeEqual(sig,sign(payload)))return false;try{const s=JSON.parse(Buffer.from(payload,'base64url').toString());return s.email===ALLOWED_EMAIL&&s.exp>Date.now();}catch{return false;}}
function setCookie(res,name,value,maxAge){res.setHeader('Set-Cookie',name+'='+encodeURIComponent(value)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge);}
async function handle(req,res){
 const url=new URL(req.url,'https://bharul.invalid');
 if(url.pathname==='/auth/status'&&req.method==='GET'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({configured:configured(),signedIn:session(req)}));}
 if(url.pathname==='/auth/google'&&req.method==='GET'){
  if(!configured()){res.writeHead(503,{'content-type':'text/plain'});return res.end('Google Sign-In is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET and GOOGLE_REDIRECT_URI in Render.');}
  const state=randomBytes(24).toString('base64url');setCookie(res,STATE_COOKIE,state,600);
  const target=client(req).generateAuthUrl({scope:['openid','email','profile'],state,prompt:'select_account'});
  res.writeHead(302,{Location:target,'Cache-Control':'no-store'});return res.end();
 }
 if(url.pathname==='/auth/callback'&&req.method==='GET'){
  if(!configured()){res.writeHead(503);return res.end('Google Sign-In is not configured.');}
  const state=url.searchParams.get('state')||'',expected=cookie(req,STATE_COOKIE);
  setCookie(res,STATE_COOKIE,'',0);
  if(!state||!expected||!safeEqual(state,expected)){res.writeHead(400);return res.end('Sign-in verification failed. Please try again.');}
  try{
   const {tokens}=await client(req).getToken(url.searchParams.get('code')||'');
   const ticket=await client(req).verifyIdToken({idToken:tokens.id_token,audience:process.env.GOOGLE_CLIENT_ID});
   const p=ticket.getPayload();
   if(!p||!p.email||p.email.toLowerCase()!==ALLOWED_EMAIL||p.email_verified!==true){res.writeHead(403,{'content-type':'text/html; charset=utf-8'});return res.end('<h1>Access denied</h1><p>This Google account is not authorized for Bharul.</p><a href="/login.html">Try another account</a>');}
   const payload=Buffer.from(JSON.stringify({email:ALLOWED_EMAIL,exp:Date.now()+7*24*60*60*1000})).toString('base64url');
   setCookie(res,COOKIE,payload+'.'+sign(payload),7*24*60*60);
   res.writeHead(302,{Location:'/', 'Cache-Control':'no-store'});return res.end();
  }catch(e){res.writeHead(400,{'content-type':'text/plain'});return res.end('Google sign-in could not be completed. Please try again.');}
 }
 if(url.pathname==='/auth/logout'&&req.method==='POST'){setCookie(res,COOKIE,'',0);res.writeHead(303,{Location:'/login.html','Cache-Control':'no-store'});return res.end();}
 return false;
}
module.exports={configured,session,handle};
