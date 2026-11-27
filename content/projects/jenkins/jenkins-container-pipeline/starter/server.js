// Starts the Campus Notes API. Usage: node server.js (PORT defaults to 3000).
import { createApp } from "./src/app.js";

const port = Number(process.env.PORT ?? 3000);
createApp().listen(port, () => console.log(`Campus Notes API listening on http://localhost:${port}`));
