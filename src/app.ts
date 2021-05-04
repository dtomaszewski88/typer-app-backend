import express from "express";
import _, { forEach, set, String } from "lodash";
import path from "path";
import cookieParser from "cookie-parser";
import logger from "morgan";
import mongoose from "mongoose";
import { v4 as uuid } from "uuid";
import cors from "cors";
import socket, { Server } from "socket.io";
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

const words = [
  "weather",
  "wedding",
  "week",
  "weekend",
  "weekly",
  "weigh",
  "via",
  // 'victim',
  // 'victory',
  // 'video',
  // 'view',
  // 'viewer',
  // 'village',
  // 'violate',
  // 'violation',
  // 'violence',
  // 'violent',
  // 'virtually',
  // 'virtue',
  // 'virus',
  // 'visible',
  // 'vision',
  // 'visit',
  // 'visitor',
  // 'visual',
  // 'vital',
];
app.get("/words", function (req, res) {
  return res.send(words);
});

type Game = {
  id: string;
  words: ReadonlyArray<string>;
  players: {
    [key: string]: {
      id: string;
      isReady: boolean;
      currentText: string;
      currentWordIndex: number;
    };
  };
};
type GameSet = {
  [key: string]: Game;
};

let quickGameQueue: Array<string> = [];
let currentQuickGames: GameSet = {};

const apiServer = app.listen(API_PORT, function () {
  console.log(`Listening on port ${API_PORT}`);
  console.log(`http://localhost:${API_PORT}`);
});

// Socket setup
const io = new Server(apiServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

const QUEUE_CHECK_INTERVAL = 5000;

const isGameReady = (game: Game) =>
  _.chain(game).get("players").values().every(["isReady", true]).value();

const setPlayerReady = (game: Game, playerId: string) => {
  game.players[playerId].isReady = true;
};

const setText = (game: Game, playerId: string, text: string) => {
  game.players[playerId].currentText = text;
};

const completeWord = (game: Game, playerId: string) => {
  game.players[playerId].currentText = "";
  game.players[playerId].currentWordIndex++;
};

const checkGameQueue = () => {
  if (quickGameQueue.length >= 2) {
    const [playerId1, playerId2, ...rest] = quickGameQueue;
    const game = {
      id: uuid(),
      words: words,
      players: {
        [playerId1]: {
          id: playerId1,
          isReady: false,
          currentText: "",
          currentWordIndex: 0,
        },
        [playerId2]: {
          id: playerId2,
          isReady: false,
          currentText: "",
          currentWordIndex: 0,
        },
      },
    };
    currentQuickGames[game.id] = game;
    const gameRoomId = `game-${game.id}`;
    io.in([playerId1, playerId2]).socketsJoin(gameRoomId);
    io.to(gameRoomId).emit("gameSearchSuccess", game);
    quickGameQueue = rest;
  }
};

const queueCheckInterval = setInterval(checkGameQueue, QUEUE_CHECK_INTERVAL);

io.on("connection", function (socket: Socket) {
  console.log("Made socket connection", socket.id);
  socket.on("incrementAll", (data) => {
    console.log("incrementAll", data);
    socket.broadcast.emit("incrementAllData", data);
  });
  socket.on("updateLocalText", ({ gameId, currentText }) => {
    const game = currentQuickGames[gameId];
    const gameRoomId = `game-${gameId}`;
    setText(game, socket.id, currentText);
    socket.to(gameRoomId).emit("gameUpdate", game);
    console.log("updateLocalText", gameId, currentText);
  });
  socket.on("completeWord", ({ gameId }) => {
    const game = currentQuickGames[gameId];
    const gameRoomId = `game-${gameId}`;
    completeWord(game, socket.id);
    socket.to(gameRoomId).emit("gameUpdate", game);
  });
  socket.on("gameSearchInit", (data) => {
    quickGameQueue.push(socket.id);
    console.log("gameSearchInit", data);
  });
  socket.on("playerReadyInit", ({ gameId }) => {
    const game = currentQuickGames[gameId];
    const gameRoomId = `game-${gameId}`;
    setPlayerReady(game, socket.id);
    socket.join(gameRoomId);
    if (isGameReady(game)) {
      io.to(gameRoomId).emit("gameReadySuccess", game);
    }
  });
  socket.on("disconnect", () => {
    console.log("disconnect");
    io.emit("user disconnected", socket.id);
  });
});

export default app;
