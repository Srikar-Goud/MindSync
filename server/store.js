import { MongoClient } from 'mongodb';

const clone = (value) => structuredClone(value);

export class MemoryRoomStore {
  constructor() { this.rooms = new Map(); }
  async connect() {}
  async create(room) {
    if (this.rooms.has(room.code)) return false;
    this.rooms.set(room.code, clone(room));
    return true;
  }
  async get(code) { const room = this.rooms.get(code); return room ? clone(room) : null; }
  async delete(code) { return this.rooms.delete(code); }
  async compareAndSet(code, expectedRevision, next) {
    const current = this.rooms.get(code);
    if (!current || current.revision !== expectedRevision) return false;
    this.rooms.set(code, clone({ ...next, revision: expectedRevision + 1 }));
    return true;
  }
  async list() { return [...this.rooms.values()].map(clone); }
  async close() {}
}

export class MongoRoomStore {
  constructor(uri, databaseName = 'mindsync') {
    this.client = new MongoClient(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 10_000 });
    this.databaseName = databaseName;
  }
  async connect() {
    await this.client.connect();
    this.collection = this.client.db(this.databaseName).collection('rooms');
    await this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }
  async create(room) {
    try {
      await this.collection.insertOne({ ...room, _id: room.code });
      return true;
    } catch (error) {
      if (error?.code === 11000) return false;
      throw error;
    }
  }
  async get(code) {
    const room = await this.collection.findOne({ _id: code });
    if (!room) return null;
    const { _id, ...rest } = room;
    return rest;
  }
  async delete(code) { await this.collection.deleteOne({ _id: code }); }
  async compareAndSet(code, expectedRevision, next) {
    const { code: _code, revision: _revision, ...fields } = next;
    const result = await this.collection.updateOne(
      { _id: code, revision: expectedRevision },
      { $set: { ...fields, revision: expectedRevision + 1 } },
    );
    return result.modifiedCount === 1;
  }
  async list() {
    const rows = await this.collection.find({}).limit(10_000).toArray();
    return rows.map(({ _id, ...rest }) => rest);
  }
  async close() { await this.client.close(); }
}

