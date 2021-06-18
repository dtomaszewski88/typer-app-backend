import express from "express";
import _, { forEach, set, String } from "lodash";
import path from "path";
import cookieParser from "cookie-parser";
import logger from "morgan";
import mongoose from "mongoose";
import { v4 as uuid } from "uuid";
import cors from "cors";
import { Server } from "socket.io";
import type { Socket } from "socket.io";
import indexRouter from "./routes/index";
import usersRouter from "./routes/users";

const app = express();

const API_PORT = process.env.PORT || 8080;
app.use(cors());

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "../public")));

app.use("/", indexRouter);
app.use("/users", usersRouter);

const WORDS = [
  "weather",
  "wedding",
  "week",
  "weekend",
  "weekly",
  "weigh",
  "via",
  "victim",
  "victory",
  "video",
  "view",
  "viewer",
  "village",
  "violate",
  "violation",
  "violence",
  "violent",
  "virtually",
  "virtue",
  "virus",
  "visible",
  "vision",
  "visit",
  "visitor",
  "visual",
  "vital",
];

app.get("/words", function (req, res) {
  return res.send(getWords(WORDS));
});

const getWords = (words: ReadonlyArray<string>) => _.slice(words, 0, 2);

type PlayerEntry = {
  id: string;
  name: string;
  isReady: boolean;
  currentText: string;
  currentWordIndex: number;
  score: number;
};

type Game = {
  id: string;
  words: ReadonlyArray<string>;
  startTime: number;
  players: {
    [key: string]: PlayerEntry;
  };
};

type GameSet = {
  [key: string]: Game;
};

type PlayerQueueEntry = {
  id: string;
  name: string;
};

const apiServer = app.listen(API_PORT, function () {
  console.log(`Listening on port ${API_PORT}`);
  console.log(`http://localhost:${API_PORT}`);
});

// Socket setup
const io = new Server(apiServer, {
  cors: {
    origin: `http://localhost:${API_PORT}`,
    methods: ["GET", "POST"],
  },
});

const QUEUE_CHECK_INTERVAL = 1000;
let playerQueue: Array<PlayerQueueEntry> = [];
let currentQuickGames: GameSet = {};
let gameHistory: Array<Game> = [];
let gameIdByPlayerId: { [key: string]: string } = {};

const createGame = (matchedPlayers: ReadonlyArray<PlayerQueueEntry>) => {
  const players = _.chain(matchedPlayers)
    .map((player) => ({
      ...player,
      isReady: false,
      currentText: "",
      currentWordIndex: 0,
      score: 0,
    }))
    .keyBy("id")
    .value();
  return {
    id: uuid(),
    words: getWords(WORDS),
    startTime: 0,
    players,
  };
};

const calcScore = (word: string, time: number, errors = 0) => {
  const timeInSec = time / 1000;
  const minScore = word.length * 500;
  const maxScore = Math.round((minScore * 5) / timeInSec - errors * 100);
  return Math.max(minScore, maxScore);
};

const isGameReady = (game: Game) =>
  _.chain(game).get("players").values().every(["isReady", true]).value();
const isGameOver = (game: Game) =>
  _.chain(game)
    .get("players")
    .values()
    .some(["currentWordIndex", game.words.length])
    .value();

const setPlayerReady = (game: Game, playerId: string) => {
  game.players[playerId].isReady = true;
};

const setText = (game: Game, playerId: string, text: string) => {
  game.players[playerId].currentText = text;
};

const completeWord = (game: Game, playerId: string, errors: number) => {
  const currentTime = Date.now();
  const timeDiff = currentTime - game.startTime;
  const playerGame = game.players[playerId];
  const wordIndex = playerGame.currentWordIndex;
  const currentWord = game.words[wordIndex];

  playerGame.score += calcScore(currentWord, timeDiff, errors);
  playerGame.currentText = "";
  playerGame.currentWordIndex++;
};

const startGame = (game: Game) => {
  game.startTime = Date.now();
};

const getGameRoomId = (gameId: string) => `game-${gameId}`;

const PLAYERS = 3;
const checkGameQueue = () => {
  if (playerQueue.length >= PLAYERS) {
    const matchedPlayers = _.slice(playerQueue, 0, PLAYERS);
    const matchedPlayersIds = _.map(matchedPlayers, "id");
    const remainingPlayers = _.slice(playerQueue, PLAYERS);

    const game = createGame(matchedPlayers);
    currentQuickGames[game.id] = game;
    const gameRoomId = getGameRoomId(game.id);

    _.forEach(
      matchedPlayersIds,
      (playerId) => (gameIdByPlayerId[playerId] = game.id)
    );
    io.in(matchedPlayersIds).socketsJoin(gameRoomId);
    io.to(gameRoomId).emit("gameSearchSuccess", game);
    playerQueue = remainingPlayers;
  }
};

const queueCheckInterval = setInterval(checkGameQueue, QUEUE_CHECK_INTERVAL);

io.on("connection", function (socket: Socket) {
  socket.on("updateLocalText", ({ gameId, currentText }) => {
    const game = currentQuickGames[gameId];
    const gameRoomId = getGameRoomId(gameId);
    setText(game, socket.id, currentText);
    socket.to(gameRoomId).emit("gameUpdate", game);
  });

  socket.on("completeWord", ({ gameId, errors }) => {
    const game = currentQuickGames[gameId];
    const gameRoomId = getGameRoomId(gameId);
    completeWord(game, socket.id, errors);
    if (isGameOver(game)) {
      io.in(gameRoomId).emit("gameOver", game);
    } else {
      io.in(gameRoomId).emit("gameUpdate", game);
    }
  });

  socket.on("gameSearchInit", ({ name }) => {
    playerQueue.push({ id: socket.id, name });
  });

  socket.on("playerReadyInit", ({ gameId }) => {
    const game = currentQuickGames[gameId];
    const gameRoomId = getGameRoomId(gameId);
    setPlayerReady(game, socket.id);
    socket.join(gameRoomId);

    if (isGameReady(game)) {
      startGame(game);
      io.to(gameRoomId).emit("gameReadySuccess", game);
    }
  });

  socket.on("disconnect", () => {
    const gameId = gameIdByPlayerId[socket.id];
    const gameRoomId = getGameRoomId(gameId);
    console.log("disconnect");
    io.in(gameRoomId).emit("playerDisconnected", socket.id, gameRoomId);
  });
});

export default app;
