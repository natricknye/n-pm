import { handle } from '../server/router.js';

export default async function handler(req, res) {
  return handle(req, res);
}
