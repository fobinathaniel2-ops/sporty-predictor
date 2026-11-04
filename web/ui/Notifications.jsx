import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import { A, Empty, Modal, Seg } from './base';
import { store, useApi, useApp } from '../lib/app';
import { inScope, permission, showLocal, typeOn } from '../lib/push';

const ICON = { goal: '⚽', kickoff: '🟢', fulltime: '🏁', result: '🎯', soon: '⏰' };
const ago = (iso) => { const s = Math.max(0, (Date.now() - new Date(iso)) / 1000); return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

export default function Bell() {
  const { prefs } = useApp();
  const q = useApi('/api/notifications', { poll: prefs.dataSaver ? 120000 : 60000 });
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState(prefs.notify?.scope || 'favourites');
  const [seen, setSeen] = useState(() => store.get('sp_seen', null) || new Date().toISOString());
  const alerted = useRef(store.get('sp_alerted', null) || new Date().toISOString());
  useEffect(() => { if (!store.get('sp_seen', null)) store.set('sp_seen', seen); }, []); // first visit: start from now, no flood

  const events = q.data?.events || [];
  const mine = useMemo(() => events.filter((e) => typeOn(e, prefs) && inScope(e, prefs, prefs.notify?.scope || 'favourites')), [events, prefs]);
  const unread = mine.filter((e) => e.at > seen).length;

  // alerts from the open app when push messages are not set up on this device
  useEffect(() => {
    if (!events.length) return;
    const fresh = mine.filter((e) => e.at > alerted.current);
    if (!fresh.length) return;
    alerted.current = events[0].at; store.set('sp_alerted', alerted.current);
    if (prefs.notify?.on && permission() === 'granted' && !store.get('sp_push', false)) fresh.slice(0, 3).reverse().forEach(showLocal);
  }, [events]); // eslint-disable-line

  const shown = events.filter((e) => typeOn(e, prefs) && inScope(e, prefs, scope));
  const close = () => { setOpen(false); const t = events[0]?.at || new Date().toISOString(); setSeen(t); store.set('sp_seen', t); };

  return (
    <>
      <button className="iconbtn bell" onClick={() => setOpen(true)} aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}>
        <Icon name="bell" size={20} />{unread > 0 && <span className="bdot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <Modal title="Notifications" onClose={close} footer={<A to="/profile" className="btn wide" onClick={close}>Alert settings</A>}>
          <Seg value={scope} onChange={setScope} options={[['favourites', 'My teams'], ['all', 'All matches']]} />
          <div style={{ marginTop: 12 }}>
            {shown.length ? shown.map((e) => (
              <A key={e.id} to={`/match/${e.matchId}`} className={`nitem ${e.at > seen ? 'new' : ''}`} onClick={close}>
                <span className="nico">{ICON[e.type] || '•'}</span>
                <span className="grow" style={{ minWidth: 0 }}><b className="sm" style={{ display: 'block' }}>{e.title}</b>{e.body && <span className="xs muted">{e.body}</span>}</span>
                <span className="xs dim">{ago(e.at)}</span>
              </A>
            )) : (
              <Empty icon="bell" title={scope === 'favourites' && !prefs.favTeams.length && !prefs.favLeagues.length ? 'No favourites yet' : 'Nothing yet'}>
                {scope === 'favourites' && !prefs.favTeams.length && !prefs.favLeagues.length ? 'Tap the star on a team or league to follow it, or switch to All matches.' : 'Goals, kick-offs, full-time scores and pick results show here.'}
              </Empty>)}
          </div>
        </Modal>)}
    </>
  );
}
