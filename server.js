const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const app = express();
const allowed = (process.env.ALLOWED_ORIGINS || "*").split(",").map(x => x.trim()).filter(Boolean);
app.use(cors({ origin: allowed.includes("*") ? true : allowed }));
app.get("/", (_req, res) => res.json({ name: "MATHRINA Multiplayer Server", status: "online" }));
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: allowed.includes("*") ? true : allowed, methods: ["GET", "POST"] }, transports: ["websocket", "polling"] });
const rooms = new Map(), MAX_PLAYERS = 35;
const makeCode = () => { const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; for (let i=0;i<6;i++) s += chars[Math.floor(Math.random()*chars.length)]; return s; };
const snapshot = r => ({ code:r.code, mode:r.mode, hostId:r.hostId, players:[...r.players.values()] });
function cleanName(v){return String(v||"Guest").replace(/[<>]/g,"").trim().slice(0,16)||"Guest";}
function clamp(v,a,b){v=Number(v);return Number.isFinite(v)?Math.max(a,Math.min(b,v)):0;}
function leave(socket){const code=socket.data.roomCode;if(!code)return;const r=rooms.get(code);socket.leave(code);socket.data.roomCode=null;if(!r)return;r.players.delete(socket.id);if(!r.players.size)rooms.delete(code);else{if(r.hostId===socket.id)r.hostId=r.players.keys().next().value;io.to(code).emit("room:update",snapshot(r));}}
io.on("connection",socket=>{
 socket.on("room:create",(data={},reply=()=>{})=>{const mode=data.mode;if(!["coop","race"].includes(mode))return reply({ok:false,error:"Mode tidak valid."});leave(socket);let code;do{code=makeCode()}while(rooms.has(code));const p={id:socket.id,name:cleanName(data.name),x:0,y:0,z:3,ready:true};const r={code,mode,hostId:socket.id,players:new Map([[socket.id,p]]),started:false};rooms.set(code,r);socket.join(code);socket.data.roomCode=code;reply({ok:true,room:snapshot(r),isHost:true});io.to(code).emit("room:update",snapshot(r));});
 socket.on("room:join",(data={},reply=()=>{})=>{const code=String(data.code||"").trim().toUpperCase(),r=rooms.get(code);if(!r)return reply({ok:false,error:"Room tidak ditemukan."});if(r.started)return reply({ok:false,error:"Permainan sudah dimulai."});if(r.players.size>=MAX_PLAYERS)return reply({ok:false,error:"Room penuh (maksimal 35 pemain)."});leave(socket);r.players.set(socket.id,{id:socket.id,name:cleanName(data.name),x:0,y:0,z:3,ready:true});socket.join(code);socket.data.roomCode=code;reply({ok:true,room:snapshot(r),isHost:false});io.to(code).emit("room:update",snapshot(r));});
 socket.on("room:set-mode",(data={},reply=()=>{})=>{const r=rooms.get(socket.data.roomCode);if(!r||r.hostId!==socket.id)return reply({ok:false,error:"Hanya host yang dapat memilih mode."});if(!["coop","race"].includes(data.mode))return reply({ok:false,error:"Mode tidak valid."});r.mode=data.mode;io.to(r.code).emit("room:update",snapshot(r));reply({ok:true,room:snapshot(r)});});
 socket.on("room:start",(_data={},reply=()=>{})=>{const r=rooms.get(socket.data.roomCode);if(!r||r.hostId!==socket.id)return reply({ok:false,error:"Hanya host yang dapat memulai."});r.started=true;io.to(r.code).emit("game:start",{code:r.code,mode:r.mode});reply({ok:true});});
 socket.on("player:move",pos=>{const r=rooms.get(socket.data.roomCode);if(!r||!r.players.has(socket.id))return;const p=r.players.get(socket.id);p.x=clamp(pos?.x,-33,33);p.y=0;p.z=clamp(pos?.z,-27,27);socket.to(r.code).emit("player:moved",{id:socket.id,name:p.name,x:p.x,y:0,z:p.z});});
 socket.on("room:leave",()=>leave(socket));socket.on("disconnect",()=>leave(socket));
});
const PORT=process.env.PORT||3000;httpServer.listen(PORT,"0.0.0.0",()=>console.log("MATHRINA server listening on "+PORT));
