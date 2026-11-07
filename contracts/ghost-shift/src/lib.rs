use near_sdk::store::LookupMap;
use near_sdk::{
  env, near, require, AccountId, Gas, GasWeight, NearToken, PanicOnDefault,
  PromiseError,
};

const YIELD_REGISTER: u64 = 0;
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
const DEFAULT_YIELD_TIMEOUT_BLOCKS: u64 = 200;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum JobStatus {
  Open,
  Leased,
  YieldPending,
  Completed,
  Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RejectionCode {
  InvalidInput,
  JobAlreadyExists,
  JobNotFound,
  JobNotOpen,
  LeaseStillActive,
  StaleEpochRejected,
  TerminalStateImmutable,
  ScopedKeyPermissionDenied,
  YieldNotPending,
  YieldIdMismatch,
  YieldTimeoutNotReached,
  YieldTimeoutExpired,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct JobRecord {
  pub job_id: String,
  pub client_account_id: AccountId,
  pub bounty_yocto: u128,
  pub lease_duration_ms: u64,
  pub status: JobStatus,
  pub current_epoch: u64,
  pub active_holder: Option<AccountId>,
  pub lease_expires_at_ms: Option<u64>,
  pub candidate_result_id: Option<String>,
  pub yield_id_hex: Option<String>,
  pub yield_deadline_block: Option<u64>,
  pub winning_epoch: Option<u64>,
  pub winning_worker: Option<AccountId>,
  pub accepted_result_id: Option<String>,
  pub paid_yocto: u128,
  pub refunded_yocto: u128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ResumeVerifyPayload {
  pub job_id: String,
  pub epoch: u64,
  pub verifier_id: AccountId,
  pub approved: bool,
  pub tee_signer_verified: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct GhostShiftContract {
  pub verifier_account_id: AccountId,
  pub yield_timeout_blocks: u64,
  pub total_funded_yocto: u128,
  pub escrowed_locked_yocto: u128,
  pub total_paid_out_yocto: u128,
  pub total_refunded_yocto: u128,
  pub jobs: LookupMap<String, JobRecord>,
}

#[near]
impl GhostShiftContract {
  #[init]
  pub fn new(verifier_account_id: AccountId) -> Self {
    Self {
      verifier_account_id,
      yield_timeout_blocks: DEFAULT_YIELD_TIMEOUT_BLOCKS,
      total_funded_yocto: 0,
      escrowed_locked_yocto: 0,
      total_paid_out_yocto: 0,
      total_refunded_yocto: 0,
      jobs: LookupMap::new(b"j"),
    }
  }

  #[payable]
  pub fn create_job(&mut self, job_id: String, lease_duration_ms: u64) {
    let deposit = env::attached_deposit().as_yoctonear();
    require!(!job_id.trim().is_empty(), "InvalidInput");
    require!(deposit > 0 && lease_duration_ms > 0, "InvalidInput");
    require!(!self.jobs.contains_key(&job_id), "JobAlreadyExists");

    let record = JobRecord {
      job_id: job_id.clone(),
      client_account_id: env::predecessor_account_id(),
      bounty_yocto: deposit,
      lease_duration_ms,
      status: JobStatus::Open,
      current_epoch: 0,
      active_holder: None,
      lease_expires_at_ms: None,
      candidate_result_id: None,
      yield_id_hex: None,
      yield_deadline_block: None,
      winning_epoch: None,
      winning_worker: None,
      accepted_result_id: None,
      paid_yocto: 0,
      refunded_yocto: 0,
    };

    self.total_funded_yocto = self.total_funded_yocto.saturating_add(deposit);
    self.escrowed_locked_yocto = self.escrowed_locked_yocto.saturating_add(deposit);
    self.jobs.insert(job_id, record);
  }

  pub fn claim_lease(&mut self, job_id: String) -> u64 {
    let now_ms = env::block_timestamp_ms();
    let caller = env::predecessor_account_id();
    let job = self.jobs.get_mut(&job_id).expect("JobNotFound");

    require!(
      job.status != JobStatus::Completed && job.status != JobStatus::Refunded,
      "TerminalStateImmutable"
    );
    require!(job.status == JobStatus::Open, "JobNotOpen");

    job.status = JobStatus::Leased;
    job.current_epoch = 1;
    job.active_holder = Some(caller);
    job.lease_expires_at_ms = Some(now_ms.saturating_add(job.lease_duration_ms));
    job.current_epoch
  }

  pub fn heartbeat(&mut self, job_id: String, epoch: u64) {
    let now_ms = env::block_timestamp_ms();
    let caller = env::predecessor_account_id();
    let job = self.jobs.get_mut(&job_id).expect("JobNotFound");

    require!(
      job.status != JobStatus::Completed && job.status != JobStatus::Refunded,
      "TerminalStateImmutable"
    );
    require!(
      job.status == JobStatus::Leased
        && job.current_epoch == epoch
        && job.active_holder.as_ref() == Some(&caller),
      "StaleEpochRejected"
    );

    job.lease_expires_at_ms = Some(now_ms.saturating_add(job.lease_duration_ms));
  }

  pub fn takeover_lease(&mut self, job_id: String) -> u64 {
    let now_ms = env::block_timestamp_ms();
    let current_block = env::block_height();
    let caller = env::predecessor_account_id();
    let job = self.jobs.get_mut(&job_id).expect("JobNotFound");

    require!(
      job.status != JobStatus::Completed && job.status != JobStatus::Refunded,
      "TerminalStateImmutable"
    );

    let can_takeover = match job.status {
      JobStatus::Leased => job
        .lease_expires_at_ms
        .map(|exp| now_ms >= exp)
        .unwrap_or(false),
      JobStatus::YieldPending => job
        .yield_deadline_block
        .map(|deadline| current_block >= deadline)
        .unwrap_or(false),
      _ => false,
    };
    require!(can_takeover, "LeaseStillActive");

    job.status = JobStatus::Leased;
    job.current_epoch = job.current_epoch.saturating_add(1);
    job.active_holder = Some(caller);
    job.lease_expires_at_ms = Some(now_ms.saturating_add(job.lease_duration_ms));
    job.candidate_result_id = None;
    job.yield_id_hex = None;
    job.yield_deadline_block = None;
    job.current_epoch
  }

  pub fn submit_result(&mut self, job_id: String, epoch: u64, result_id: String) {
    let current_block = env::block_height();
    let caller = env::predecessor_account_id();
    require!(!result_id.trim().is_empty(), "InvalidInput");

    let job = self.jobs.get_mut(&job_id).expect("JobNotFound");
    require!(
      job.status != JobStatus::Completed && job.status != JobStatus::Refunded,
      "TerminalStateImmutable"
    );
    require!(
      job.status == JobStatus::Leased
        && job.current_epoch == epoch
        && job.active_holder.as_ref() == Some(&caller),
      "StaleEpochRejected"
    );

    let callback_args = serde_json::to_vec(&serde_json::json!({
      "job_id": job_id,
      "expected_epoch": epoch,
    }))
    .expect("Failed to serialize yield callback args");

    let promise_idx = env::promise_yield_create(
      "on_verify_settled",
      &callback_args,
      CALLBACK_GAS,
      GasWeight::default(),
      YIELD_REGISTER,
    );

    let yield_bytes = env::read_register(YIELD_REGISTER).unwrap_or_default();
    let yield_hex: String = yield_bytes.iter().map(|b| format!("{:02x}", b)).collect();

    job.status = JobStatus::YieldPending;
    job.candidate_result_id = Some(result_id);
    job.yield_id_hex = Some(yield_hex);
    job.yield_deadline_block =
      Some(current_block.saturating_add(self.yield_timeout_blocks));

    env::promise_return(promise_idx);
  }

  pub fn resume_verify(
    &mut self,
    yield_id_bytes: Vec<u8>,
    payload: ResumeVerifyPayload,
  ) -> bool {
    let caller = env::predecessor_account_id();
    require!(
      caller == self.verifier_account_id,
      "ScopedKeyPermissionDenied"
    );

    let job = self.jobs.get(&payload.job_id).expect("JobNotFound");
    require!(
      job.status != JobStatus::Completed && job.status != JobStatus::Refunded,
      "TerminalStateImmutable"
    );
    require!(job.status == JobStatus::YieldPending, "YieldNotPending");
    require!(job.current_epoch == payload.epoch, "StaleEpochRejected");

    let payload_bytes =
      serde_json::to_vec(&payload).expect("Failed to serialize resume payload");
    let yield_arr: [u8; 32] = yield_id_bytes
      .try_into()
      .expect("YieldIdMismatch: yield_id must be 32 bytes");
    env::promise_yield_resume(&yield_arr, &payload_bytes)
  }

  #[private]
  pub fn on_verify_settled(
    &mut self,
    job_id: String,
    expected_epoch: u64,
    #[callback_result] resume_result: Result<ResumeVerifyPayload, PromiseError>,
  ) -> JobStatus {
    let job = self.jobs.get_mut(&job_id).expect("JobNotFound");
    if job.status == JobStatus::Completed || job.status == JobStatus::Refunded {
      return job.status;
    }
    if job.current_epoch != expected_epoch || job.status != JobStatus::YieldPending {
      return job.status;
    }

    match resume_result {
      Ok(payload)
        if payload.approved
          && payload.tee_signer_verified
          && payload.epoch == job.current_epoch =>
      {
        let payout = job.bounty_yocto;
        job.status = JobStatus::Completed;
        job.winning_epoch = Some(job.current_epoch);
        job.winning_worker = job.active_holder.clone();
        job.accepted_result_id = job.candidate_result_id.clone();
        job.paid_yocto = payout;
        job.yield_id_hex = None;
        job.yield_deadline_block = None;

        self.escrowed_locked_yocto =
          self.escrowed_locked_yocto.saturating_sub(payout);
        self.total_paid_out_yocto =
          self.total_paid_out_yocto.saturating_add(payout);
        JobStatus::Completed
      }
      _ => {
        // YieldTimeoutExpired or rejected verification: unlock back to Leased without trapping funds
        job.status = JobStatus::Leased;
        job.candidate_result_id = None;
        job.yield_id_hex = None;
        job.yield_deadline_block = None;
        JobStatus::Leased
      }
    }
  }

  pub fn cancel_expired_job(&mut self, job_id: String) -> NearToken {
    let now_ms = env::block_timestamp_ms();
    let current_block = env::block_height();
    let caller = env::predecessor_account_id();
    let job = self.jobs.get_mut(&job_id).expect("JobNotFound");

    require!(caller == job.client_account_id, "ScopedKeyPermissionDenied");
    require!(
      job.status != JobStatus::Completed && job.status != JobStatus::Refunded,
      "TerminalStateImmutable"
    );

    let can_cancel = match job.status {
      JobStatus::Open => true,
      JobStatus::Leased => job
        .lease_expires_at_ms
        .map(|exp| now_ms >= exp)
        .unwrap_or(false),
      JobStatus::YieldPending => job
        .yield_deadline_block
        .map(|deadline| current_block >= deadline)
        .unwrap_or(false),
      _ => false,
    };
    require!(can_cancel, "LeaseStillActive");

    let refund = job.bounty_yocto;
    job.status = JobStatus::Refunded;
    job.active_holder = None;
    job.candidate_result_id = None;
    job.yield_id_hex = None;
    job.yield_deadline_block = None;
    job.refunded_yocto = refund;

    self.escrowed_locked_yocto = self.escrowed_locked_yocto.saturating_sub(refund);
    self.total_refunded_yocto = self.total_refunded_yocto.saturating_add(refund);

    NearToken::from_yoctonear(refund)
  }
}
