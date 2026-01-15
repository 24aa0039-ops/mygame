/**
 * 3D Maze Adventure - Full Custom AI Edition
 */
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const infoUI = document.getElementById('info');
const msgUI = document.getElementById('message');

// ==== デバイス判定 ====
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// レイ数分岐
let RAYS = isTouch ? 160 : 300;


let W = window.innerWidth;
let H = window.innerHeight;
canvas.width = W;
canvas.height = H;


// 動的に変更するため let に変更
let MAP_W = 21, MAP_H = 21; 
const FOV = Math.PI / 3; 

let map = [], keys = {};
let px = 1.5, py = 1.5, pa = 0, pitch = 0, score = 0, timeLeft = 60;
let gameRunning = false, lastTime = 0, gameMode = 'easy';
let enemies = []; 
let items = [], depthBuffer = []; 
let goal = { x: 0, y: 0, color: '#ff00ff' };
let config = { enemySpeed: 1.5, playerSpeed: 3.5, rotSpeed: 2.8, itemCount: 15 };

// ===== スマホ操作状態 =====
let touchState = {
    forward: false,
    back: false,
    turn: 0   // -1:左回転 / +1:右回転
};

// --- スワイプ用（スマホ視点操作） ---
let lastTouchX = 0;
let lastTouchY = 0;



/* ===== 経路探索(BFS)エンジン ===== */
const GameAI = {
    getDistanceField: function(px, py, grid) {
        let field = Array.from({length: MAP_H}, () => Array(MAP_W).fill(Infinity));
        let startX = Math.floor(px), startY = Math.floor(py);
        if (startY < 0 || startY >= MAP_H || startX < 0 || startX >= MAP_W) return field;
        
        let queue = [[startX, startY, 0]];
        field[startY][startX] = 0;

        while (queue.length > 0) {
            let [cx, cy, d] = queue.shift();
            [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx, dy]) => {
                let nx = cx + dx, ny = cy + dy;
                if (ny >= 0 && ny < MAP_H && nx >= 0 && nx < MAP_W && grid[ny][nx] === 0 && field[ny][nx] === Infinity) {
                    field[ny][nx] = d + 1;
                    queue.push([nx, ny, d + 1]);
                }
            });
        }
        return field;
    },

    getEnemyNext: function(ex, ey, px, py, grid) {
        const distField = this.getDistanceField(px, py, grid);
        const cx = Math.floor(ex), cy = Math.floor(ey);
        let bestDist = distField[cy][cx];
        let bestTarget = {x: cx + 0.5, y: cy + 0.5};

        [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx, dy]) => {
            let nx = cx + dx, ny = cy + dy;
            if (ny >= 0 && ny < MAP_H && nx >= 0 && nx < MAP_W && grid[ny][nx] === 0) {
                if (distField[ny][nx] < bestDist) {
                    bestDist = distField[ny][nx];
                    bestTarget = {x: nx + 0.5, y: ny + 0.5};
                }
            }
        });
        if (bestDist === Infinity || (bestTarget.x === ex && bestTarget.y === ey)) {
             return [ex + (px > ex ? 0.1 : -0.1), ey + (py > ey ? 0.1 : -0.1)];
        }
        return [bestTarget.x, bestTarget.y];
    },

    getRandomPos: function(grid, minDist) {
        let x, y;
        let tries = 0;
        do {
            x = Math.random() * MAP_W | 0; y = Math.random() * MAP_H | 0;
            tries++;
        } while ((grid[y][x] !== 0 || Math.hypot(x + 0.5 - px, y + 0.5 - py) < minDist) && tries < 100);
        return { x: x + 0.5, y: y + 0.5 };
    }
};

/* ===== ゲーム生成 & 初期化 ===== */
function generateMaze(enemyCount) {
    map = Array.from({length: MAP_H}, () => Array(MAP_W).fill(1));
    const stack = [[1, 1]]; map[1][1] = 0;
    while (stack.length > 0) {
        const [cx, cy] = stack[stack.length - 1];
        const neighbors = [[0,-2],[2,0],[0,2],[-2,0]].map(([dx,dy]) => [cx+dx, cy+dy, dx, dy])
            .filter(([nx,ny]) => nx>0 && ny>0 && nx<MAP_W-1 && ny<MAP_H-1 && map[ny][nx]===1);
        if (!neighbors.length) stack.pop();
        else {
            const [nx,ny,dx,dy] = neighbors[Math.floor(Math.random()*neighbors.length)];
            map[cy+dy/2|0][cx+dx/2|0] = 0; map[ny][nx] = 0; stack.push([nx,ny]);
        }
    }
    px = 1.5; py = 1.5; pa = 0; pitch = 0; score = 0;
    
    // ゴール配置
    const gPos = GameAI.getRandomPos(map, Math.floor(MAP_W/2)); 
    goal.x = gPos.x; goal.y = gPos.y;
    
    // エネミー生成（複数対応）
    enemies = [];
    for(let i=0; i<enemyCount; i++) {
        const ePos = GameAI.getRandomPos(map, 8);
        enemies.push({ x: ePos.x, y: ePos.y, targetX: ePos.x, targetY: ePos.y });
    }
    spawnItems();
}

function spawnItems() {
    items = [];
    // カスタム設定のアイテム数を使用
    for(let i=0; i<config.itemCount; i++) { 
        let p = GameAI.getRandomPos(map, 2); 
        items.push({x: p.x, y: p.y, type: 'coin', color: '#ffd700'}); 
    }
    for(let i=0; i<2; i++) { 
        let p = GameAI.getRandomPos(map, 5); 
        items.push({x: p.x, y: p.y, type: 'time', color: '#00ffff'}); 
    }
}

function startGame(mode) {
    gameMode = mode;
    let enemyCount = 1;

    if (mode === 'custom') {
        // HTMLのUIから値を読み込む
        MAP_W = MAP_H = customVals.mapSize;
        enemyCount = customVals.enemyCount;
        config.enemySpeed = customVals.enemySpeed;
        config.itemCount = customVals.itemCount;
        timeLeft = customVals.startTime;
        document.getElementById('modeDetail').innerHTML = `⚙️ CUSTOM: ${MAP_W}x${MAP_H} / 敵: ${enemyCount}体`;
    } else {
        // プリセットモード
        MAP_W = MAP_H = 21;
        config.itemCount = 15;
        timeLeft = 60;
        config.enemySpeed = (mode === 'easy') ? 1.0 : 1.8;
        document.getElementById('modeDetail').innerHTML = (mode === 'normal') ? "NORMAL: 30秒までゴール非表示！" : "EASY: 練習モード";
    }

    generateMaze(enemyCount);
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('ruleScreen').style.display = 'flex';
}

function closeRules() {
    document.getElementById('ruleScreen').style.display = 'none';
    document.getElementById('ui').style.display = 'block';
    gameRunning = true; lastTime = performance.now(); loop();
}

function backToTitle() { gameRunning = false; location.reload(); }

/* ===== 描画 ===== */
function draw() {
    ctx.fillStyle = "#87CEEB"; ctx.fillRect(0, 0, W, H / 2 + pitch);
    ctx.fillStyle = "#4a7c44"; ctx.fillRect(0, H / 2 + pitch, W, H / 2 - pitch);
    
    depthBuffer = [];
    for (let i = 0; i < RAYS; i++) {
        let rayAngle = (pa - FOV / 2) + (i / RAYS) * FOV;
        let dist = 0, sx = px, sy = py;
        const cos = Math.cos(rayAngle) * 0.05, sin = Math.sin(rayAngle) * 0.05;
        while (dist < 20) {
            sx += cos; sy += sin; dist += 0.05;
            if (map[sy | 0][sx | 0] === 1) break;
        }
        depthBuffer.push(dist);
        let wallH = H / (dist * Math.cos(rayAngle - pa) + 0.001);
        let shade = Math.max(0, 200 - dist * 15);
        ctx.fillStyle = `rgb(${shade}, ${shade * 0.8}, ${shade * 1.2})`;
        ctx.fillRect(i * (W/RAYS), (H - wallH) / 2 + pitch, (W/RAYS) + 1, wallH);
    }

    let showGoal = (gameMode !== 'normal' || timeLeft <= 30);
    const sprites = [...items.map(i=>({...i, isEn:false, isGoal:false})), ...enemies.map(en=>({...en, isEn:true, isGoal:false}))];
    if (showGoal) sprites.push({...goal, isEn:false, isGoal:true});

    sprites.sort((a,b) => Math.hypot(b.x-px, b.y-py) - Math.hypot(a.x-px, a.y-py)).forEach(s => {
        const dx = s.x - px, dy = s.y - py, dist = Math.hypot(dx, dy);
        let angle = Math.atan2(dy, dx) - pa;
        while (angle < -Math.PI) angle += Math.PI * 2;
        while (angle > Math.PI) angle -= Math.PI * 2;
        if (Math.abs(angle) < FOV / 2 && dist < 15) {
            const rayIdx = Math.floor((angle / FOV + 0.5) * RAYS);
            if (dist < (depthBuffer[rayIdx] || 20)) {
                const screenX = (angle / (FOV/2) * 0.5 + 0.5) * W;
                const size = H / dist, sy = H/2 - size/2 + pitch;
                ctx.fillStyle = s.isEn ? "#ff4d4d" : s.color;
                if (s.isGoal) ctx.fillRect(screenX - size/4, sy - size/2, size/2, size*1.5);
                else if (s.isEn) ctx.fillRect(screenX - size/3, sy + size/4, size*0.6, size*0.6);
                else { ctx.beginPath(); ctx.arc(screenX, sy + size/2, size/6, 0, 7); ctx.fill(); }
            }
        }
    });

    // ミニマップ
    const ts = Math.max(2, 160 / MAP_W), ox = W - (MAP_W * ts) - 20, oy = H - (MAP_H * ts) - 20;
    ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(ox-5, oy-5, MAP_W*ts+10, MAP_H*ts+10);
    for(let y=0; y<MAP_H; y++) for(let x=0; x<MAP_W; x++) if(map[y][x]===1) { ctx.fillStyle="#444"; ctx.fillRect(ox+x*ts, oy+y*ts, ts, ts); }
    if (showGoal) { ctx.fillStyle=goal.color; ctx.fillRect(ox+goal.x*ts-2, oy+goal.y*ts-2, 4, 4); }
    ctx.fillStyle = "#f00"; enemies.forEach(en => ctx.fillRect(ox + en.x * ts - 1, oy + en.y * ts - 1, 3, 3));
    ctx.fillStyle="#0f0"; ctx.fillRect(ox+px*ts-2, oy+py*ts-2, 4, 4); 
}

/* ===== ループ ===== */
async function loop() {
    if (!gameRunning) return;
    const now = performance.now(), dt = Math.min((now - lastTime)/1000, 0.1); 
    lastTime = now; timeLeft -= dt;

    if (keys['t']) { backToTitle(); return; }

    if (keys['a'] || keys['arrowleft']) pa -= config.rotSpeed * dt;
    if (keys['d'] || keys['arrowright']) pa += config.rotSpeed * dt;
    // スマホ回転
    if (isTouch && touchState.turn !== 0) {
    pa += touchState.turn * config.rotSpeed * dt;
    }

    let move = (keys['w'] || keys['arrowup'] ? 1 : keys['s'] || keys['arrowdown'] ? -1 : 0);
    if (isTouch && touchState.forward) move = 1;

    if (move !== 0) {
        let nx = px + Math.cos(pa) * config.playerSpeed * dt * move;
        let ny = py + Math.sin(pa) * config.playerSpeed * dt * move;
        if (map[ny|0] && map[ny|0][nx|0] === 0) { px = nx; py = ny; }
    }

    // --- 敵の全個体移動処理 ---
    enemies.forEach(en => {
        const distToTarget = Math.hypot(en.x - en.targetX, en.y - en.targetY);
        if (distToTarget < 0.1) {
            en.x = en.targetX; en.y = en.targetY;
            const [nextX, nextY] = GameAI.getEnemyNext(en.x, en.y, px, py, map);
            en.targetX = nextX; en.targetY = nextY;
        }
        const ang = Math.atan2(en.targetY - en.y, en.targetX - en.x);
        if (distToTarget > 0.01) {
            en.x += Math.cos(ang) * config.enemySpeed * dt;
            en.y += Math.sin(ang) * config.enemySpeed * dt;
        }
    });

    // アイテム判定
    items = items.filter(it => {
        if (Math.hypot(it.x - px, it.y - py) < 0.5) {
            if (it.type === 'coin') { score += 100; showMsg("COIN +100!"); }
            else { timeLeft += 25; showMsg("TIME +25s!"); }
            return false;
        } return true;
    });

    // 終了判定
    if ((gameMode !== 'normal' || timeLeft <= 30) && Math.hypot(px - goal.x, py - goal.y) < 0.7) {
        gameRunning = false; alert("GOAL!! SCORE: " + score); backToTitle(); return;
    }
    
    // 全エネミーとの当たり判定
    if (enemies.some(en => Math.hypot(px-en.x, py-en.y) < 0.4) || timeLeft <= 0) {
        gameRunning = false; alert(timeLeft <= 0 ? "TIME UP!" : "GAME OVER"); backToTitle(); return;
    }

    infoUI.innerText = `SCORE: ${score} | TIME: ${Math.max(0, Math.ceil(timeLeft))}s`;
    draw(); requestAnimationFrame(loop);
}

function showMsg(txt) { msgUI.innerText = txt; msgUI.style.display = 'block'; setTimeout(() => msgUI.style.display = 'none', 800); }
window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
canvas.addEventListener('click', () => { if (gameRunning) canvas.requestPointerLock(); });
document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas && gameRunning) {
        let sens = (document.getElementById('sensRange')?.value || 10) * 0.0002;
        pa += e.movementX * sens; 
        pitch = Math.max(-250, Math.min(250, pitch - e.movementY * 1.2));
    }
});

// ===== スマホ用タッチ操作（追記のみ）=====
if (isTouch) {

    canvas.addEventListener('touchstart', e => {
        const t = e.touches[0];

        lastTouchX = t.clientX;
        lastTouchY = t.clientY;

        const x = t.clientX;
        const w = window.innerWidth;

        // 左40%：前進
        if (x < w * 0.4) {
            touchState.forward = true;
        }

        // 右40%：視点回転
        if (x > w * 0.6) {
            touchState.turn = (x > w * 0.8) ? 1 : -1;
        }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
        touchState.forward = false;
        touchState.back = false;
        touchState.turn = 0;
    }, { passive: true });
}

canvas.addEventListener('touchmove', e => {
    const t = e.touches[0];

    const dx = t.clientX - lastTouchX;
    const dy = t.clientY - lastTouchY;

    lastTouchX = t.clientX;
    lastTouchY = t.clientY;

    // 横スワイプ：回転（マウスに近い操作）
    pa += dx * 0.003;

    // 縦スワイプ：視点上下
    pitch = Math.max(-250, Math.min(250, pitch - dy * 0.8));
}, { passive: true });

if (isTouch) {
    // スマホは横向き推奨
    screen.orientation?.lock?.("landscape").catch(()=>{});
}

function checkOrientation() {
    if (isTouch && window.innerHeight > window.innerWidth) {
        msgUI.innerText = "📱 横向きでプレイしてください";
        msgUI.style.display = 'block';
    } else {
        msgUI.style.display = 'none';
    }
}
window.addEventListener('resize', checkOrientation);
checkOrientation();
