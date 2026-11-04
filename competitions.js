'use strict';
/** The only competitions this app covers. `code` = football-data.org code when that source has it; the rest are found by Gemini web search. */
const LIST = [
  { name: 'English Premier League', code: 'PL', alias: ['premier league england', 'epl', 'english premier league'] },
  { name: 'English Championship', code: 'ELC', alias: ['championship', 'efl championship'] },
  { name: 'FA Cup' },
  { name: 'EFL Cup (Carabao Cup)', alias: ['efl cup', 'carabao cup', 'league cup'] },
  { name: 'Spanish La Liga', code: 'PD', alias: ['la liga', 'laliga', 'primera division spain'] },
  { name: 'Copa del Rey' },
  { name: 'Italian Serie A', code: 'SA', alias: ['serie a', 'serie a italy'] },
  { name: 'Coppa Italia' },
  { name: 'German Bundesliga', code: 'BL1', alias: ['bundesliga', '1 bundesliga'] },
  { name: 'DFB-Pokal', alias: ['dfb pokal', 'german cup'] },
  { name: 'French Ligue 1', code: 'FL1', alias: ['ligue 1'] },
  { name: 'Coupe de France' },
  { name: 'Portuguese Primeira Liga', code: 'PPL', alias: ['primeira liga', 'liga portugal'] },
  { name: 'Dutch Eredivisie', code: 'DED', alias: ['eredivisie'] },
  { name: 'KNVB Cup', alias: ['knvb beker'] },
  { name: 'Belgian Pro League', alias: ['jupiler pro league', 'pro league belgium'] },
  { name: 'Scottish Premiership', alias: ['spfl premiership'] },
  { name: 'UEFA Champions League', code: 'CL', alias: ['champions league'] },
  { name: 'UEFA Europa League', code: 'EL', alias: ['europa league'] },
  { name: 'UEFA Conference League', alias: ['europa conference league', 'conference league'] },
  { name: 'UEFA Super Cup' },
  { name: 'FIFA World Cup', code: 'WC', alias: ['world cup', 'world cup qualifiers', 'fifa world cup qualification'] },
  { name: 'FIFA Club World Cup', alias: ['club world cup'] },
  { name: 'UEFA European Championship (EURO)', code: 'EC', alias: ['euro', 'european championship', 'uefa euro', 'euro qualifiers'] },
  { name: 'UEFA Nations League', alias: ['nations league'] },
  { name: 'Copa América', alias: ['copa america'] },
  { name: 'Africa Cup of Nations (AFCON)', alias: ['afcon', 'africa cup of nations', 'afcon qualifiers'] },
  { name: 'CAF Champions League', alias: ['caf champions league'] },
  { name: 'CAF Confederation Cup' },
  { name: 'CAF Super Cup' },
  { name: 'Ghana Premier League' },
  { name: 'Nigeria Premier Football League', alias: ['npfl', 'nigeria premier league', 'nigerian premier football league'] },
  { name: 'South African Premiership', alias: ['dstv premiership', 'betway premiership', 'psl'] },
  { name: 'Egyptian Premier League', alias: ['egypt premier league'] },
  { name: 'Moroccan Botola Pro', alias: ['botola pro', 'botola', 'moroccan botola pro 1'] },
  { name: 'Saudi Pro League', alias: ['roshn saudi league', 'saudi league'] },
  { name: 'Major League Soccer (MLS)', alias: ['mls', 'major league soccer'] },
  { name: 'Brazilian Série A', code: 'BSA', alias: ['brasileirao', 'brazilian serie a', 'serie a brazil', 'campeonato brasileiro'] },
  { name: 'Argentine Primera División', alias: ['liga profesional', 'argentine primera division', 'primera division argentina'] },
  { name: 'Copa Libertadores', code: 'CLI' },
  { name: 'Copa Sudamericana' },
  { name: 'AFC Champions League Elite', alias: ['afc champions league'] },
  { name: 'AFC Asian Cup', alias: ['asian cup'] },
  { name: 'CONCACAF Gold Cup', alias: ['gold cup'] },
];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const index = new Map();
for (const c of LIST) { index.set(norm(c.name), c); for (const a of c.alias || []) index.set(norm(a), c); }

/** Map whatever Gemini wrote to one of the allowed competitions, or null. */
function canonical(name, country) {
  const k = norm(name);
  if (k === 'premier league') return /scot/i.test(country) ? null : /ghana|nigeria|egypt|south africa/i.test(country) ? LIST.find((c) => norm(c.name).startsWith(norm(country).split(' ')[0])) || null : LIST[0];
  if (k === 'serie a' && /brazil/i.test(country)) return LIST.find((c) => c.code === 'BSA');
  if (k === 'primera division' && /argentin/i.test(country)) return LIST.find((c) => /Argentine/.test(c.name));
  return index.get(k) || null;
}

const NAMES = LIST.map((c) => c.name);
const CODES = LIST.filter((c) => c.code).map((c) => c.code);
const FREE_CODES = ['PL', 'ELC', 'PD', 'SA', 'BL1', 'FL1', 'DED', 'PPL', 'BSA', 'CL', 'EC', 'WC'];
const byCode = (code) => LIST.find((c) => c.code === code) || null;

module.exports = { LIST, NAMES, CODES, FREE_CODES, canonical, byCode };
