// All tables are in a private, non-API schema. Only the authenticated server
// uses this adapter; none of the DB connection credentials reach the browser.
export class StudioDatabase {
  constructor(sql) { this.sql=sql; }
  async config() { return (await this.sql`select * from studio_private.config where singleton=true`)[0]; }
  async authorizedDevice(tokenHash) {
    const rows=await this.sql`select 1 from studio_private.device_keys where token_hash=${tokenHash} and expires_at>now()`;
    return rows.length===1;
  }
  async pair(codeHash,deviceHash) {
    return this.sql.begin(async tx=>{
      const [config]=await tx`select pair_code_hash,pair_expires_at,pair_attempts from studio_private.config where singleton=true for update`;
      if(!config?.pair_code_hash || config.pair_attempts>=10 || Date.parse(config.pair_expires_at)<=Date.now()) return false;
      await tx`update studio_private.config set pair_attempts=pair_attempts+1 where singleton=true`;
      if(config.pair_code_hash!==codeHash) return false;
      await tx`insert into studio_private.device_keys(token_hash) values(${deviceHash})`;
      await tx`update studio_private.config set pair_code_hash=null,pair_expires_at=null,pair_attempts=0 where singleton=true`;
      return true;
    });
  }
  async credentials() {
    return (await this.sql`select c.kaggle_username, v.decrypted_secret as token from studio_private.config c join vault.decrypted_secrets v on v.id=c.kaggle_secret_id where c.singleton=true`)[0];
  }
  async setup(username,token) {
    return this.sql.begin(async tx=>{
      const [config]=await tx`select * from studio_private.config where singleton=true for update`;
      if(config.active_id) return false;
      let secretId=config.kaggle_secret_id;
      if(secretId) await tx`select vault.update_secret(${secretId}::uuid,${token},'private_ai_studio_kaggle','Private AI Studio Kaggle API authentication')`;
      else { const [row]=await tx`select vault.create_secret(${token},'private_ai_studio_kaggle','Private AI Studio Kaggle API authentication') as id`; secretId=row.id; }
      await tx`update studio_private.config set kaggle_username=${username},kaggle_secret_id=${secretId}::uuid where singleton=true`;
      return true;
    });
  }
  async latest() { return (await this.sql`select record from studio_private.jobs order by (record->>'createdAt') desc limit 1`)[0]?.record; }
  async get(id) { return (await this.sql`select record from studio_private.jobs where id=${id}::uuid`)[0]?.record; }
  async claim(record) {
    // Commit the job BEFORE calling Kaggle. A network error must not roll back
    // the idempotency record and accidentally allow a second GPU submission.
    return this.sql.begin(async tx=>{
      const [config]=await tx`select active_id from studio_private.config where singleton=true for update`;
      const [prior]=await tx`select record from studio_private.jobs where id=${record.id}::uuid`;
      if(prior) return {prior:prior.record};
      if(config.active_id) {
        const [active]=await tx`select record from studio_private.jobs where id=${config.active_id}::uuid`;
        if(active) return {active:active.record};
      }
      await tx`insert into studio_private.jobs(id,record) values(${record.id}::uuid,${tx.json(record)})`;
      await tx`update studio_private.config set active_id=${record.id}::uuid where singleton=true`;
      return {created:true};
    });
  }
  async save(record) {
    return this.sql.begin(async tx=>{
      await tx`update studio_private.jobs set record=${tx.json(record)} where id=${record.id}::uuid`;
      if(['completed','failed'].includes(record.status)) await tx`update studio_private.config set active_id=null where singleton=true and active_id=${record.id}::uuid`;
    });
  }
  async claimPoll(id) {
    return this.sql.begin(async tx=>{
      const [row]=await tx`select record from studio_private.jobs where id=${id}::uuid for update`;
      if(!row) return {missing:true};
      const record=row.record;
      if(['completed','failed'].includes(record.status) || Date.now()-record.checkedAt<30000) return {record,cached:true};
      record.checkedAt=Date.now();
      await tx`update studio_private.jobs set record=${tx.json(record)} where id=${id}::uuid`;
      return {record,cached:false};
    });
  }
}
