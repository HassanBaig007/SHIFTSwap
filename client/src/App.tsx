import { useEffect, useState } from 'react'
import './App.css'

type Role = 'STAFF' | 'MANAGER'
type Person = { id: string; name: string; role: Role; certifications: string[] }
type Shift = { id: string; start: string; end: string; required_certification: string | null; assigned_to: string }
type Listing = { id: string; shiftId: string; posterId: string; status: 'OPEN' | 'CLAIMED' | 'WITHDRAWN' | 'APPROVED'; claimerId: string | null }
type Reason = { rule: number; message: string; shiftId?: string }
type Eligibility = { allowed: boolean; reasons: Reason[] }
type History = { id: string; actorName: string; action: string; shiftId: string; outcome: string; message: string; timestamp: string }
type State = { staff: Person[]; shifts: Shift[]; listings: Listing[]; history: History[]; eligibility: Record<string, Eligibility> }

function formatDate(value: string) {
  const [date, time] = value.split('T')
  const [, month, day] = date.split('-')
  return `${month}/${day} · ${time}`
}

function App() {
  const [actorId, setActorId] = useState(() => localStorage.getItem('shiftswap-actor') || 'S1')
  const [state, setState] = useState<State | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const actor = state?.staff.find((person) => person.id === actorId)

  useEffect(() => {
    localStorage.setItem('shiftswap-actor', actorId)
    let cancelled = false
    async function fetchState() {
      try {
        const response = await fetch(`/api/bootstrap?actorId=${actorId}`)
        if (!response.ok) throw new Error('Unable to load the ShiftSwap workspace.')
        if (!cancelled) setState(await response.json())
      } catch (error) { if (!cancelled) setFeedback({ kind: 'error', text: (error as Error).message }) }
    }
    fetchState()
    return () => { cancelled = true }
  }, [actorId])

  async function perform(path: string, key: string, body: Record<string, string> = {}) {
    setBusy(key); setFeedback(null)
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorId, ...body }) })
      const data = await response.json()
      if (!response.ok) {
        const detail = data.reasons?.map((reason: Reason) => `Rule ${reason.rule}: ${reason.message}`).join(' ') || data.error
        setFeedback({ kind: 'error', text: detail })
      } else { setFeedback({ kind: 'success', text: data.message }); setState(data) }
    } catch { setFeedback({ kind: 'error', text: 'Could not reach the backend.' }) } finally { setBusy(null) }
  }

  if (!state || !actor) return <main className="loading"><span className="brand-mark">SS</span><h1>Loading ShiftSwap</h1><p>Connecting to the clinic roster.</p></main>
  const staffById = Object.fromEntries(state.staff.map((person) => [person.id, person]))
  const listingForShift = (shiftId: string) => state.listings.find((listing) => listing.shiftId === shiftId && ['OPEN', 'CLAIMED'].includes(listing.status))
  const ownShifts = state.shifts.filter((shift) => shift.assigned_to === actor.id)
  const offers = state.listings.filter((listing) => listing.status === 'OPEN' && listing.posterId !== actor.id)
  const myClaims = state.listings.filter((listing) => listing.status === 'CLAIMED' && listing.claimerId === actor.id)
  const queue = state.listings.filter((listing) => listing.status === 'CLAIMED')

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">SS</span><div><strong>ShiftSwap</strong><span>CityCare clinic roster</span></div></div><label className="actor-picker">Acting as<select value={actorId} onChange={(event) => setActorId(event.target.value)}>{state.staff.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.role}</option>)}</select></label></header>
    <section className="welcome"><div><p className="kicker">{actor.role === 'MANAGER' ? 'MANAGER CONTROL DESK' : 'STAFF WORKSPACE'}</p><h1>Good to see you, {actor.name}.</h1><p>{actor.role === 'MANAGER' ? 'Review pending swaps and keep the roster compliant.' : 'Trade coverage with confidence. Every rule is checked before a claim moves forward.'}</p></div><div className="identity"><span className={actor.role === 'MANAGER' ? 'role manager' : 'role'}>{actor.role}</span><span>{actor.certifications.length ? actor.certifications.join(' · ') : 'No certifications'}</span></div></section>
    {feedback && <div className={`feedback ${feedback.kind}`} role="status">{feedback.text}<button onClick={() => setFeedback(null)} aria-label="Dismiss feedback">×</button></div>}
    {actor.role === 'MANAGER' ? <section className="workspace"><SectionHeading label="DECISIONS" title="Approval queue" count={`${queue.length} pending`} />{queue.length ? <div className="listing-grid">{queue.map((listing) => { const shift = state.shifts.find((item) => item.id === listing.shiftId)!; return <article className="swap-card featured" key={listing.id}><CardTop status="CLAIMED" id={shift.id} /><h3>{formatDate(shift.start)}</h3><p className="time">{formatDate(shift.start)} — {shift.end.split('T')[1]}</p><dl><div><dt>Current owner</dt><dd>{staffById[shift.assigned_to]?.name}</dd></div><div><dt>Claimant</dt><dd>{staffById[listing.claimerId || '']?.name}</dd></div></dl><div className="actions"><button className="primary" disabled={busy === listing.id} onClick={() => perform(`/api/listings/${listing.id}/approve`, listing.id)}>{busy === listing.id ? 'Working...' : 'Approve swap'}</button><button className="secondary" disabled={busy === listing.id} onClick={() => perform(`/api/listings/${listing.id}/reject`, listing.id)}>Reject</button></div></article> })}</div> : <Empty title="No swaps need review" detail="Claimed listings will appear here for approval." />}</section> : <><section className="workspace"><SectionHeading label="YOUR COVERAGE" title="My shifts" count={`${ownShifts.length} assigned`} /><div className="listing-grid">{ownShifts.map((shift) => { const listing = listingForShift(shift.id); return <article className="swap-card" key={shift.id}><CardTop status={listing?.status || 'ASSIGNED'} id={shift.id} /><h3>{formatDate(shift.start)}</h3><p className="time">{formatDate(shift.start)} — {shift.end.split('T')[1]}</p><p className="cert">{shift.required_certification ? `Requires ${shift.required_certification}` : 'General coverage'}</p>{listing?.status === 'OPEN' ? <button className="secondary full" disabled={busy === listing.id} onClick={() => perform(`/api/listings/${listing.id}/withdraw`, listing.id)}>Withdraw listing</button> : listing?.status === 'CLAIMED' ? <p className="note">Claimed by {staffById[listing.claimerId || '']?.name}; awaiting manager.</p> : <button className="secondary full" disabled={Boolean(listing) || busy === shift.id} onClick={() => perform('/api/listings', shift.id, { shiftId: shift.id })}>{busy === shift.id ? 'Posting...' : 'Post for swap'}</button>}</article> })}</div></section>{myClaims.length > 0 && <section className="workspace"><SectionHeading label="AWAITING APPROVAL" title="My pending claims" count={`${myClaims.length} pending`} /><div className="listing-grid">{myClaims.map((listing) => { const shift = state.shifts.find((item) => item.id === listing.shiftId)!; return <article className="swap-card featured" key={listing.id}><CardTop status="CLAIMED" id={shift.id} /><h3>{formatDate(shift.start)}</h3><p className="time">{formatDate(shift.start)} — {shift.end.split('T')[1]}</p><p className="note">Your claim is waiting for manager approval. The shift remains assigned to {staffById[shift.assigned_to]?.name} until approval.</p><button className="secondary full" disabled={busy === listing.id} onClick={() => perform(`/api/listings/${listing.id}/unclaim`, listing.id)}>{busy === listing.id ? 'Releasing...' : 'Unclaim shift'}</button></article> })}</div></section>}<section className="workspace"><SectionHeading label="AVAILABLE COVERAGE" title="Open listings" count={`${offers.length} available`} />{offers.length ? <div className="listing-grid">{offers.map((listing) => { const shift = state.shifts.find((item) => item.id === listing.shiftId)!; const check = state.eligibility[listing.id]; return <article className="swap-card" key={listing.id}><CardTop status="OPEN" id={shift.id} /><h3>{formatDate(shift.start)}</h3><p className="time">{formatDate(shift.start)} — {shift.end.split('T')[1]}</p><p className="note">Posted by {staffById[listing.posterId]?.name} · {shift.required_certification ? `${shift.required_certification} certification` : 'No certification required'}</p>{check?.allowed ? <p className="eligible">Eligible to claim</p> : <ul className="reasons">{check?.reasons.map((reason) => <li key={`${reason.rule}-${reason.shiftId || 'target'}`}><b>Rule {reason.rule}</b> {reason.message}</li>)}</ul>}<button className="primary full" disabled={!check?.allowed || busy === listing.id} onClick={() => perform(`/api/listings/${listing.id}/claim`, listing.id)}>{busy === listing.id ? 'Claiming...' : 'Claim shift'}</button></article> })}</div> : <Empty title="No open listings" detail="When colleagues post shifts, they will show up here." />}</section></>}
    <section className="history workspace"><SectionHeading label="AUDIT TRAIL" title="Recent activity" count={`${state.history.length} events`} />{state.history.length ? <div className="history-list">{state.history.slice(0, 12).map((item) => <div className="history-row" key={item.id}><span className={`outcome ${item.outcome.toLowerCase()}`}>{item.outcome}</span><div><strong>{item.actorName}</strong> <span>{item.action.toLowerCase()} {item.shiftId}</span><small>{item.message}</small></div><time>{new Date(item.timestamp).toLocaleString()}</time></div>)}</div> : <Empty title="Nothing recorded yet" detail="Actions will appear here as the roster changes." />}</section>
  </main>
}

function SectionHeading({ label, title, count }: { label: string; title: string; count: string }) { return <div className="section-heading"><div><p className="kicker">{label}</p><h2>{title}</h2></div><span className="count">{count}</span></div> }
function CardTop({ status, id }: { status: string; id: string }) { return <div className="card-top"><span className={`status ${status.toLowerCase()}`}>{status}</span><span>{id}</span></div> }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty"><h3>{title}</h3><p>{detail}</p></div> }

export default App
