const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");
const restartButton = document.querySelector("#restartButton");
const gamepadStatus = document.querySelector("#gamepadStatus");

const TILE = 36;
const VIEW_WIDTH = canvas.width;
const VIEW_HEIGHT = canvas.height;
const GRAVITY = 2500;
const MOVE_ACCEL = 4200;
const MAX_SPEED = 330;
const FRICTION = 3200;
const JUMP_SPEED = 850;
const FIXED_STEP = 1 / 60;

const colors = {
  sky: "#6fb7ff",
  cloud: "#dff3ff",
  hill: "#5bbd73",
  hillDark: "#3f8d55",
  ground: "#b96c33",
  groundTop: "#58b957",
  block: "#d58a3a",
  blockDark: "#9d552b",
  hardBlock: "#7d8aa2",
  coin: "#ffd54f",
  player: "#e95050",
  playerDark: "#9f2d2d",
  enemy: "#7b4bd6",
  enemyDark: "#4b2a8b",
  goal: "#f7f2d6",
  text: "#101522",
  overlay: "rgba(16, 21, 34, 0.72)"
};

const keys = new Set();
const pressed = new Set();
const gamepadInput = {
  activeIndex: null,
  activeName: "",
  axisX: 0,
  left: false,
  right: false,
  jump: false,
  connected: false,
  supported: "getGamepads" in navigator
};

const levelRows = [
  "....................................................................................................................................",
  "....................................................................................................................................",
  "....................................................................................................................................",
  "....................................................................................................................................",
  "............................................................................................................................G.......",
  ".......................................................................................CCC..................................GG.......",
  "..............................CCC.....................................................BBBB.................................GGG.......",
  "...............C.........................................CCCCC...........................................CCC................GGGG.......",
  "..............BBB.........................B..B.......................................E..............................BB.....GGGGG.......",
  "........................................BBBBBB..............................BBB..............BB...................BBBB.....GGGGGG......",
  ".......P................E...........................BBB...............E..................BBBBBB.........E..............................",
  "TTTTTTTTTTTTTTTTTTTTTTTTTT..TTTTTTTTTTTTTTTTTTTTTTTTTTTT..TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT..TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
  "XXXXXXXXXXXXXXXXXXXXXXXXXX..XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX..XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX..XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "XXXXXXXXXXXXXXXXXXXXXXXXXX..XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX..XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX..XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "XXXXXXXXXXXXXXXXXXXXXXXXXX..XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX..XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX..XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
];

const level = parseLevel(levelRows);
let state = createState();
let accumulator = 0;
let lastTime = performance.now();

function parseLevel(rows) {
  const solidTiles = new Map();
  const coins = [];
  const enemies = [];
  let spawn = { x: TILE * 2, y: TILE * 4 };
  let goal = { x: (rows[0].length - 4) * TILE, y: TILE * 5, width: TILE, height: TILE * 6 };

  rows.forEach((row, y) => {
    [...row].forEach((tile, x) => {
      const worldX = x * TILE;
      const worldY = y * TILE;

      if (tile === "P") {
        spawn = { x: worldX, y: worldY };
      } else if (tile === "C") {
        coins.push({ x: worldX + 9, y: worldY + 9, width: 18, height: 18, collected: false });
      } else if (tile === "E") {
        enemies.push(createEnemy(worldX + 4, worldY + 2));
      } else if (tile === "G") {
        goal = { x: worldX, y: worldY, width: TILE, height: TILE * 6 };
      } else if (isSolid(tile)) {
        solidTiles.set(tileKey(x, y), { x: worldX, y: worldY, type: tile });
      }
    });
  });

  return {
    width: rows[0].length * TILE,
    height: rows.length * TILE,
    rows,
    solidTiles,
    coins,
    enemies,
    spawn,
    goal
  };
}

function createEnemy(x, y) {
  return {
    x,
    y,
    width: 28,
    height: 30,
    vx: -70,
    vy: 0,
    alive: true,
    grounded: false
  };
}

function createState() {
  return {
    player: {
      x: level.spawn.x,
      y: level.spawn.y,
      width: 28,
      height: 34,
      vx: 0,
      vy: 0,
      grounded: false,
      invincibleTimer: 0
    },
    coins: level.coins.map((coin) => ({ ...coin })),
    enemies: level.enemies.map((enemy) => ({ ...enemy })),
    cameraX: 0,
    score: 0,
    attempts: 1,
    status: "playing",
    messageTimer: 0
  };
}

function resetGame(keepAttempts = false) {
  const attempts = keepAttempts ? state.attempts + 1 : 1;
  state = createState();
  state.attempts = attempts;
  accumulator = 0;
}

function update(dt) {
  pollGamepad();

  if (pressed.has("KeyR")) {
    resetGame();
  }

  pressed.clear();

  if (state.status !== "playing") {
    state.messageTimer += dt;
    return;
  }

  const player = state.player;
  const controls = getControls();
  const moveLeft = controls.left;
  const moveRight = controls.right;
  const jumpPressed = controls.jump;

  if (moveLeft) {
    player.vx -= MOVE_ACCEL * dt;
  }
  if (moveRight) {
    player.vx += MOVE_ACCEL * dt;
  }
  if (!moveLeft && !moveRight) {
    player.vx = approach(player.vx, 0, FRICTION * dt);
  }

  player.vx = clamp(player.vx, -MAX_SPEED, MAX_SPEED);

  if (jumpPressed && player.grounded) {
    player.vy = -JUMP_SPEED;
    player.grounded = false;
  }

  moveActor(player, dt);
  updateEnemies(dt);
  collectCoins();
  resolveEnemyCollisions();
  updateCamera();

  if (player.y > VIEW_HEIGHT + TILE * 3) {
    resetGame(true);
  }

  if (intersects(player, level.goal)) {
    state.status = "won";
  }
}

function updateEnemies(dt) {
  for (const enemy of state.enemies) {
    if (!enemy.alive) {
      continue;
    }

    const previousVx = enemy.vx;
    moveActor(enemy, dt);

    if (Math.sign(previousVx) !== Math.sign(enemy.vx) || isNearLedge(enemy)) {
      enemy.vx = previousVx > 0 ? -70 : 70;
    }

    if (enemy.y > VIEW_HEIGHT + TILE * 3) {
      enemy.alive = false;
    }
  }
}

function collectCoins() {
  for (const coin of state.coins) {
    if (!coin.collected && intersects(state.player, coin)) {
      coin.collected = true;
      state.score += 100;
    }
  }
}

function resolveEnemyCollisions() {
  const player = state.player;

  for (const enemy of state.enemies) {
    if (!enemy.alive || !intersects(player, enemy)) {
      continue;
    }

    const playerBottom = player.y + player.height;
    const stomped = player.vy > 0 && playerBottom - enemy.y < 20;

    if (stomped) {
      enemy.alive = false;
      player.vy = -JUMP_SPEED * 0.55;
      state.score += 250;
    } else {
      resetGame(true);
      return;
    }
  }
}

function moveActor(actor, dt) {
  actor.vy += GRAVITY * dt;
  actor.grounded = false;

  actor.x += actor.vx * dt;
  resolveTileCollision(actor, "x");

  actor.y += actor.vy * dt;
  resolveTileCollision(actor, "y");
}

function resolveTileCollision(actor, axis) {
  const nearby = getNearbyTiles(actor);

  for (const tile of nearby) {
    if (!intersects(actor, tile)) {
      continue;
    }

    if (axis === "x") {
      if (actor.vx > 0) {
        actor.x = tile.x - actor.width;
      } else if (actor.vx < 0) {
        actor.x = tile.x + TILE;
      }
      actor.vx = 0;
    } else if (axis === "y") {
      if (actor.vy > 0) {
        actor.y = tile.y - actor.height;
        actor.grounded = true;
      } else if (actor.vy < 0) {
        actor.y = tile.y + TILE;
      }
      actor.vy = 0;
    }
  }

  actor.x = clamp(actor.x, 0, level.width - actor.width);
}

function getNearbyTiles(actor) {
  const startX = Math.floor(actor.x / TILE) - 1;
  const endX = Math.floor((actor.x + actor.width) / TILE) + 1;
  const startY = Math.floor(actor.y / TILE) - 1;
  const endY = Math.floor((actor.y + actor.height) / TILE) + 1;
  const tiles = [];

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const tile = level.solidTiles.get(tileKey(x, y));
      if (tile) {
        tiles.push({ x: tile.x, y: tile.y, width: TILE, height: TILE, type: tile.type });
      }
    }
  }

  return tiles;
}

function isNearLedge(actor) {
  if (!actor.grounded) {
    return false;
  }

  const probeX = actor.vx > 0 ? actor.x + actor.width + 3 : actor.x - 3;
  const probeY = actor.y + actor.height + 3;
  const tileX = Math.floor(probeX / TILE);
  const tileY = Math.floor(probeY / TILE);

  return !level.solidTiles.has(tileKey(tileX, tileY));
}

function updateCamera() {
  const target = state.player.x + state.player.width / 2 - VIEW_WIDTH * 0.42;
  state.cameraX = clamp(target, 0, Math.max(0, level.width - VIEW_WIDTH));
}

function draw() {
  ctx.fillStyle = colors.sky;
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

  drawBackground();
  ctx.save();
  ctx.translate(-Math.floor(state.cameraX), 0);

  drawGoal();
  drawTiles();
  drawCoins();
  drawEnemies();
  drawPlayer();

  ctx.restore();
  drawHud();

  if (state.status === "won") {
    drawOverlay("通关！按 R 或点击按钮重玩");
  }
}

function drawBackground() {
  drawRect(80 - state.cameraX * 0.2, 74, 120, 24, colors.cloud);
  drawRect(130 - state.cameraX * 0.2, 50, 68, 24, colors.cloud);
  drawRect(420 - state.cameraX * 0.2, 92, 150, 24, colors.cloud);
  drawRect(500 - state.cameraX * 0.2, 68, 88, 24, colors.cloud);

  const hillOffset = -(state.cameraX * 0.35) % 520;
  for (let x = hillOffset - 520; x < VIEW_WIDTH + 520; x += 520) {
    drawRect(x, 392, 300, 112, colors.hillDark);
    drawRect(x + 42, 346, 220, 158, colors.hill);
  }
}

function drawTiles() {
  const startX = Math.floor(state.cameraX / TILE) - 1;
  const endX = Math.ceil((state.cameraX + VIEW_WIDTH) / TILE) + 1;

  for (let y = 0; y < level.rows.length; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const tile = level.solidTiles.get(tileKey(x, y));
      if (!tile) {
        continue;
      }

      if (tile.type === "T") {
        drawRect(tile.x, tile.y, TILE, TILE, colors.groundTop);
        drawRect(tile.x, tile.y + 10, TILE, TILE - 10, colors.ground);
      } else if (tile.type === "X") {
        drawRect(tile.x, tile.y, TILE, TILE, colors.ground);
        drawRect(tile.x + 4, tile.y + 4, TILE - 8, TILE - 8, colors.blockDark);
      } else if (tile.type === "B") {
        drawRect(tile.x, tile.y, TILE, TILE, colors.block);
        drawRect(tile.x + 5, tile.y + 5, TILE - 10, TILE - 10, colors.blockDark);
        drawRect(tile.x + 9, tile.y + 9, TILE - 18, TILE - 18, colors.block);
      }
    }
  }
}

function drawCoins() {
  for (const coin of state.coins) {
    if (!coin.collected) {
      drawRect(coin.x, coin.y, coin.width, coin.height, colors.coin);
      drawRect(coin.x + 5, coin.y + 5, coin.width - 10, coin.height - 10, "#fff09b");
    }
  }
}

function drawEnemies() {
  for (const enemy of state.enemies) {
    if (!enemy.alive) {
      continue;
    }

    drawRect(enemy.x, enemy.y, enemy.width, enemy.height, colors.enemy);
    drawRect(enemy.x + 4, enemy.y + 6, enemy.width - 8, enemy.height - 12, colors.enemyDark);
    drawRect(enemy.x + 6, enemy.y + 8, 5, 5, colors.text);
    drawRect(enemy.x + enemy.width - 11, enemy.y + 8, 5, 5, colors.text);
  }
}

function drawPlayer() {
  const player = state.player;
  drawRect(player.x, player.y, player.width, player.height, colors.player);
  drawRect(player.x + 4, player.y + 5, player.width - 8, 8, "#ff7d67");
  drawRect(player.x + 6, player.y + 15, player.width - 12, player.height - 19, colors.playerDark);
  drawRect(player.x + 18, player.y + 8, 5, 5, colors.text);
}

function drawGoal() {
  drawRect(level.goal.x + 16, level.goal.y - TILE, 8, level.goal.height + TILE, colors.goal);
  drawRect(level.goal.x + 24, level.goal.y - TILE, 54, 36, "#72f08f");
  drawRect(level.goal.x + 30, level.goal.y - TILE + 8, 36, 20, "#2e9d4d");
}

function drawHud() {
  drawRect(18, 16, 498, 42, "rgba(247, 242, 214, 0.86)");
  ctx.fillStyle = colors.text;
  ctx.font = "700 20px Segoe UI, Arial, sans-serif";
  ctx.fillText(`分数 ${state.score}`, 34, 43);
  ctx.fillText(`尝试 ${state.attempts}`, 170, 43);
  ctx.fillText(`方块 ${remainingCoins()}`, 282, 43);
  ctx.fillText(gamepadInput.connected ? `手柄 ${gamepadInput.activeIndex + 1}` : "手柄等待", 386, 43);
}

function drawOverlay(message) {
  drawRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT, colors.overlay);
  drawRect(260, 205, 440, 118, "rgba(247, 242, 214, 0.94)");
  ctx.fillStyle = colors.text;
  ctx.font = "700 30px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, VIEW_WIDTH / 2, 276);
  ctx.textAlign = "start";
}

function drawRect(x, y, width, height, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(width), Math.ceil(height));
}

function remainingCoins() {
  return state.coins.filter((coin) => !coin.collected).length;
}

function gameLoop(time) {
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;
  accumulator += dt;

  while (accumulator >= FIXED_STEP) {
    update(FIXED_STEP);
    accumulator -= FIXED_STEP;
  }

  draw();
  requestAnimationFrame(gameLoop);
}

function intersects(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function approach(value, target, amount) {
  if (value < target) {
    return Math.min(value + amount, target);
  }
  return Math.max(value - amount, target);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function tileKey(x, y) {
  return `${x},${y}`;
}

function isSolid(tile) {
  return tile === "T" || tile === "X" || tile === "B";
}

function getControls() {
  return {
    left: keys.has("ArrowLeft") || keys.has("KeyA") || gamepadInput.left,
    right: keys.has("ArrowRight") || keys.has("KeyD") || gamepadInput.right,
    jump: keys.has("Space") || keys.has("ArrowUp") || keys.has("KeyW") || gamepadInput.jump
  };
}

function pollGamepad() {
  if (!gamepadInput.supported) {
    updateGamepadStatus();
    return;
  }

  const gamepads = Array.from(navigator.getGamepads());
  const activeGamepad = gamepads.find((gamepad) => gamepad && gamepad.connected);

  if (!activeGamepad) {
    gamepadInput.activeIndex = null;
    gamepadInput.activeName = "";
    gamepadInput.axisX = 0;
    gamepadInput.left = false;
    gamepadInput.right = false;
    gamepadInput.jump = false;
    gamepadInput.connected = false;
    updateGamepadStatus();
    return;
  }

  const axisX = Math.abs(activeGamepad.axes[0] || 0) > 0.28 ? activeGamepad.axes[0] : 0;
  const dpadLeft = Boolean(activeGamepad.buttons[14]?.pressed);
  const dpadRight = Boolean(activeGamepad.buttons[15]?.pressed);

  gamepadInput.activeIndex = activeGamepad.index;
  gamepadInput.activeName = activeGamepad.id || `Gamepad ${activeGamepad.index + 1}`;
  gamepadInput.axisX = axisX;
  gamepadInput.left = dpadLeft || axisX < -0.28;
  gamepadInput.right = dpadRight || axisX > 0.28;
  gamepadInput.jump = Boolean(activeGamepad.buttons[0]?.pressed);
  gamepadInput.connected = true;
  updateGamepadStatus();
}

function updateGamepadStatus() {
  if (!gamepadStatus) {
    return;
  }

  if (!gamepadInput.supported) {
    gamepadStatus.textContent = "手柄：当前浏览器不支持 Gamepad API";
  } else if (gamepadInput.connected) {
    gamepadStatus.textContent = `手柄：已连接 ${gamepadInput.activeIndex + 1} - ${gamepadInput.activeName}`;
  } else {
    gamepadStatus.textContent = "手柄：等待连接";
  }
}

window.addEventListener("keydown", (event) => {
  const handledCodes = ["ArrowLeft", "ArrowRight", "ArrowUp", "Space", "KeyA", "KeyD", "KeyW", "KeyR"];

  if (handledCodes.includes(event.code)) {
    event.preventDefault();
  }

  if (!keys.has(event.code)) {
    pressed.add(event.code);
  }

  keys.add(event.code);
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

restartButton.addEventListener("click", () => {
  resetGame();
});

window.addEventListener("gamepadconnected", () => {
  pollGamepad();
});

window.addEventListener("gamepaddisconnected", () => {
  pollGamepad();
});

updateGamepadStatus();
requestAnimationFrame(gameLoop);
