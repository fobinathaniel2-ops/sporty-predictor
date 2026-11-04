'use strict';
// Vercel entry point: every /api/* request is rewritten here (see vercel.json). The same code runs locally with `node server.js`.
const { handle } = require('../server');
module.exports = async (req, res) => { await handle(req, res); };
