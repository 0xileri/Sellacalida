// The display cache (spec section 2): offers, challenges and agent profiles. The chain is the
// source of truth; everything here can be rebuilt from published txids and evidence blobs.
// One long-running Node process is the only writer. Writes replace the file atomically.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SellacalidaNetwork, Verdict } from '../constants';
import type { ChallengeTerms, OfferParams } from '../contracts';
import { fromJson, toJson } from '../serialize';
import type { TemplateId } from '../templates/public';
import type { Evidence } from '../verifier/evidence';

export interface AgentRecord {
  id: string;
  name: string;
  bio: string;
  /** P2PKH payout / tip address of the agent's hot wallet */
  address: string;
  pkh: string;
  modelId: string;
  createdAt: string;
}

export type OfferStatus = 'open' | 'accepted' | 'cancelled' | 'spent';

export interface OfferRecord {
  id: string; // `${txid}:${vout}`
  agentId: string;
  network: SellacalidaNetwork;
  params: OfferParams;
  txid: string;
  vout: number;
  satoshis: bigint;
  status: OfferStatus;
  challengeId: string | null;
  closeTxid: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ChallengeStatus =
  | 'awaiting_accept' // prepared, waiting for the challenger's accept tx
  | 'accepted' // escrow funded on chain, agent not answered yet
  | 'answered' // answer committed, verifier pending
  | 'settled' // verdict signed and paid out
  | 'timed_out' // refunded by timeout()
  | 'abandoned'; // prepared but never accepted

export interface ChallengeRecord {
  id: string; // challengeId hex
  offerId: string;
  agentId: string;
  network: SellacalidaNetwork;
  templateId: TemplateId;
  spec: string; // canonical JSON
  challengerAddress: string;
  terms: ChallengeTerms;
  locktime: number;
  escrowSatoshis: bigint;
  status: ChallengeStatus;
  acceptTxid: string | null;
  escrow: { txid: string; vout: number; satoshis: bigint } | null;
  verdict: Verdict | null;
  settleTxid: string | null;
  timeoutTxid: string | null;
  evidence: Evidence | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Shape {
  agents: AgentRecord[];
  offers: OfferRecord[];
  challenges: ChallengeRecord[];
}

export class Db {
  private data: Shape = { agents: [], offers: [], challenges: [] };

  /** With no path the DB lives in memory (tests, mocknet dev). */
  constructor(private readonly filePath?: string) {
    if (filePath && existsSync(filePath)) this.data = fromJson<Shape>(readFileSync(filePath, 'utf8'));
  }

  get agents(): readonly AgentRecord[] {
    return this.data.agents;
  }
  get offers(): readonly OfferRecord[] {
    return this.data.offers;
  }
  get challenges(): readonly ChallengeRecord[] {
    return this.data.challenges;
  }

  agent(id: string) {
    return this.data.agents.find((a) => a.id === id) ?? null;
  }
  offer(id: string) {
    return this.data.offers.find((o) => o.id === id) ?? null;
  }
  challenge(id: string) {
    return this.data.challenges.find((c) => c.id === id) ?? null;
  }

  upsertAgent(a: AgentRecord) {
    const i = this.data.agents.findIndex((x) => x.id === a.id);
    if (i >= 0) this.data.agents[i] = { ...a, createdAt: this.data.agents[i].createdAt };
    else this.data.agents.push(a);
    this.persist();
  }

  insertOffer(o: OfferRecord) {
    if (this.offer(o.id)) throw new Error(`offer ${o.id} already exists`);
    this.data.offers.push(o);
    this.persist();
  }

  insertChallenge(c: ChallengeRecord) {
    if (this.challenge(c.id)) throw new Error(`challenge ${c.id} already exists`);
    this.data.challenges.push(c);
    this.persist();
  }

  updateOffer(id: string, patch: Partial<OfferRecord>) {
    const o = this.offer(id);
    if (!o) throw new Error(`no offer ${id}`);
    Object.assign(o, patch, { updatedAt: new Date().toISOString() });
    this.persist();
    return o;
  }

  updateChallenge(id: string, patch: Partial<ChallengeRecord>) {
    const c = this.challenge(id);
    if (!c) throw new Error(`no challenge ${id}`);
    Object.assign(c, patch, { updatedAt: new Date().toISOString() });
    this.persist();
    return c;
  }

  private persist() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, toJson(this.data, 2));
    renameSync(tmp, this.filePath);
  }
}
