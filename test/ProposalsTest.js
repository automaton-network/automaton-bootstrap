let catchRevert            = require("./exceptions.js").catchRevert;
let catchOutOfGas          = require("./exceptions.js").catchOutOfGas;
let catchInvalidJump       = require("./exceptions.js").catchInvalidJump;
let catchInvalidOpcode     = require("./exceptions.js").catchInvalidOpcode;
let catchStackOverflow     = require("./exceptions.js").catchStackOverflow;
let catchStackUnderflow    = require("./exceptions.js").catchStackUnderflow;
let catchStaticStateChange = require("./exceptions.js").catchStaticStateChange;

let BN = web3.utils.BN;
let utils = require('./utils.js');
let increaseTime = utils.increaseTime;

const VOTE_YES = 1;
const VOTE_NO = 2;

const STATE_UNINITIALIZED = 0;
const BALLOT_STATE_PREPAYING = 1;
const BALLOT_STATE_ACTIVE = 2;
const BALLOT_STATE_INACTIVE = 3;
const PROPOSAL_STATE_STARTED = 1;
const PROPOSAL_STATE_ACCEPTED = 2;
const PROPOSAL_STATE_REJECTED = 3;
const PROPOSAL_STATE_CONTESTED = 4;
const PROPOSAL_STATE_COMPLETED = 5;

const PROPOSALS_INITIAL_PERIOD = 7;
const PROPOSALS_CONTEST_PERIOD = 7;
const PROPOSALS_MIN_PERIOD_LEN = 3;
const NUM_HISTORY_PERIODS = 128;
const TIME_UNIT_IN_SECONDS = 120;  // 2 minutes

describe('TestKingAutomatonProposals 4 slots', async() => {
  const KingAutomaton = artifacts.require("KingAutomaton");

  beforeEach(async() => {
    accounts = await web3.eth.getAccounts();
    account = accounts[0];
    slots = 4;

    // Deploy contract and create proposal.
    koh = await KingAutomaton.new(slots, 16, "0x010000", "406080000", 10, -10, 2,
        PROPOSALS_INITIAL_PERIOD, PROPOSALS_CONTEST_PERIOD, PROPOSALS_MIN_PERIOD_LEN,
        NUM_HISTORY_PERIODS, TIME_UNIT_IN_SECONDS);
    id = await koh.createProposal.call(account, "", "", "0x", 30, 3, 20);
    await koh.createProposal(account, "", "", "0x", 30, 3, 20);

    proposals_initial_period = 1 * await koh.proposalsInitialPeriod();
    proposals_contest_period = 1 * await koh.proposalsContestPeriod();
  });

  it("correct proposal creation", async() => {
    assert.equal(id, 100, "Incorrect ID!");
    assert.exists(account, "Account doesn't exist!");
    assert.exists(koh.address, "Contract wasn't deployed!");
    let ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_PREPAYING, "Ballot box state is not PrepayingGas!");
    let proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_STARTED, "Proposal state is not Started!");
    let proposal_data = await koh.proposalsData();
    assert.equal(proposal_data.approvalPercentage, 10, "Approval % in incorrect!");
    assert.equal(proposal_data.contestPercentage, -10, "Contest % in incorrect!");
  });

  it("cast vote invalid slot owner", async() => {
    await koh.payForGas(id, slots - 1);
    await catchRevert(koh.castVote(id, 0, VOTE_YES), "Invalid slot owner!");
  });

  it("cast vote invalid ballot box id", async() => {
    await koh.setOwnerAllSlots();
    await catchRevert(koh.castVote(200, 0, VOTE_YES), "Invalid ballot box ID!");
  });

  it("cast vote before gas is paid", async() => {
    await koh.setOwnerAllSlots();
    await catchRevert(koh.castVote(id, 0, VOTE_YES), "Ballot is not active!");
  });

  it("pay gas for more slots", async() => {
    await catchRevert(koh.payForGas(id, 20), "Too many slots!");
  });

  it("vote change", async() => {
    await koh.setOwnerAllSlots();
    await koh.payForGas(id, slots - 1);
    // Test initial vote values
    let vote = await koh.getVote(id, 0);
    let pos_vote_count = await koh.getVoteCount(id, 1);
    let neg_vote_count = await koh.getVoteCount(id, 2);
    assert.equal(vote, 0, "Incorrect initial vote!");
    assert.equal(pos_vote_count, 0, "Incorrect initial positive vote count!");
    assert.equal(neg_vote_count, 0, "Incorrect initial negative vote count!");
    // Cast positive vote
    await koh.castVote(id, 0, VOTE_YES);
    vote = await koh.getVote(id, 0);
    pos_vote_count = await koh.getVoteCount(id, 1);
    assert.equal(vote, 1, "Incorrect vote!");
    assert.equal(pos_vote_count, 1, "Incorrect positive vote count!");
    // Change vote
    await koh.castVote(id, 0, VOTE_NO);
    vote = await koh.getVote(id, 0);
    assert.equal(vote, 2, "Incorrect vote change!");
  });

  // 1 negative 0 positive / -25% approval < rejection %
  it("rejection during initial voting", async() => {
    await koh.setOwnerAllSlots();
    await koh.payForGas(id, slots - 1);
    // Check if states are correct
    let ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    let proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_STARTED, "Proposal state is not Started!");
    // Cast negative vote
    await koh.castVote(id, 0, VOTE_NO);
    await koh.updateProposalState(id);
    // States shouldn't change during initial time
    ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_STARTED, "Proposal state is not Started!");
    increaseTime(proposals_initial_period);
    await koh.updateProposalState(id);
    ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_INACTIVE, "Ballot box state is not Inactive!");
    proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_REJECTED, "Proposal state is not Rejected!");
    let vote_difference = await koh.calcVoteDifference(id);
    assert.equal(vote_difference, -25, "Vote difference is incorrect!");
  });

  // 0 votes / 0% approval < approval %
  it("no voting rejection during initial voting", async() => {
    await koh.setOwnerAllSlots();
    await koh.payForGas(id, slots - 1);
    await koh.updateProposalState(id);
    increaseTime(proposals_initial_period);
    await koh.updateProposalState(id);
    let ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_INACTIVE, "Ballot box state is not Inactive!");
    let proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_REJECTED, "Proposal state is not Rejected!");
    let vote_difference = await koh.calcVoteDifference(id);
    assert.equal(vote_difference, 0, "Vote difference is incorrect!");
  });

  it("approval then rejection during initial voting", async() => {
    await koh.setOwnerAllSlots();
    await koh.payForGas(id, slots - 1);

    await koh.castVotesForApproval(id);
    await koh.castVotesForRejection(id);

    increaseTime(proposals_initial_period);
    await koh.updateProposalState(id);
    let ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_INACTIVE, "Ballot box state is not Inactive!");
    let proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_REJECTED, "Proposal state is not Rejected!");
  });

  it("contested then rejection", async() => {
    await koh.setOwnerAllSlots();
    await koh.payForGas(id, slots - 1);

    await koh.castVotesForApproval(id);
    increaseTime(proposals_initial_period);
    await koh.updateProposalState(id);
    let ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    let proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_ACCEPTED, "Proposal state is not Accepted!");
    // Vote negative to enter contested state
    await koh.castVotesForRejection(id);
    await koh.updateProposalState(id);
    ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_CONTESTED, "Proposal state is not Contested!");

    // Wait for contest to end
    increaseTime(proposals_contest_period);
    await koh.updateProposalState(id);
    ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_INACTIVE, "Ballot box state is not Inactive!");
    proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_REJECTED, "Proposal state is not Rejected!");
  });

  it("contested then approval", async() => {
    await koh.setOwnerAllSlots();
    await koh.payForGas(id, slots - 1);

    // Vote positive for approval
    await koh.castVotesForApproval(id);
    await koh.updateProposalState(id);
    increaseTime(proposals_initial_period);
    await koh.updateProposalState(id);
    let ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    let proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_ACCEPTED, "Proposal state is not Accepted!");

    // Vote negative to enter contested state
    await koh.castVotesForRejection(id);
    await koh.updateProposalState(id);
    ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_CONTESTED, "Proposal state is not Contested!");

    // Vote positive
    await koh.castVotesForApproval(id);
    await koh.updateProposalState(id);
    // States shouldn't change until the end of contest
    ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_CONTESTED, "Proposal state is not Contested!");

    // Wait for contest to end
    increaseTime(proposals_contest_period);
    await koh.updateProposalState(id);
    ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_ACCEPTED, "Proposal state is not Accepted!");
  });
});

describe('TestKingAutomatonProposals 256 slots', async() => {
  const KingAutomaton = artifacts.require("KingAutomaton");

  beforeEach(async() => {
    accounts = await web3.eth.getAccounts();
    account = accounts[0];
    slots = 256;

    // Deploy contract and create proposal.
    koh = await KingAutomaton.new(slots, 16, "0x010000", "406080000", 10, -10, 2,
        PROPOSALS_INITIAL_PERIOD, PROPOSALS_CONTEST_PERIOD, PROPOSALS_MIN_PERIOD_LEN,
        NUM_HISTORY_PERIODS, TIME_UNIT_IN_SECONDS);
    id = await koh.createProposal.call(account, "", "", "0x", 30, 3, 20);
    await koh.createProposal(account, "", "", "0x", 30, 3, 20);

    proposals_initial_period = 1 * await koh.proposalsInitialPeriod();
    proposals_contest_period = 1 * await koh.proposalsContestPeriod();
  });

  it("rejection during initial voting", async() => {
    await koh.setOwnerAllSlots();

    let slots_to_pay = await koh.unpaidSlots(id);
    while (slots_to_pay >= 64) {
      await koh.payForGas(id, 64);
      slots_to_pay = await koh.unpaidSlots(id);
    }
    if (slots_to_pay > 0) {
      await koh.payForGas(id, slots_to_pay);
    }
    // Check if states are correct
    let ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    let proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_STARTED, "Proposal state is not Started!");

    await koh.castVotesForRejection(id);
    await koh.updateProposalState(id);
    // States shouldn't change during initial time
    ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_STARTED, "Proposal state is not Started!");
    increaseTime(proposals_initial_period);
    await koh.updateProposalState(id);
    ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_INACTIVE, "Ballot box state is not Inactive!");
    proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_REJECTED, "Proposal state is not Rejected!");
  });

  it("no voting rejection during initial voting", async() => {
    await koh.setOwnerAllSlots();
    let slots_to_pay = await koh.unpaidSlots(id);
    while (slots_to_pay >= 64) {
      await koh.payForGas(id, 64);
      slots_to_pay = await koh.unpaidSlots(id);
    }
    if (slots_to_pay > 0) {
      await koh.payForGas(id, slots_to_pay);
    }
    await koh.updateProposalState(id);
    increaseTime(proposals_initial_period);
    await koh.updateProposalState(id);
    let ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_INACTIVE, "Ballot box state is not Inactive!");
    let proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_REJECTED, "Proposal state is not Rejected!");
  });

  it("approval then rejection during initial voting", async() => {
    await koh.setOwnerAllSlots();
    let slots_to_pay = await koh.unpaidSlots(id);
    while (slots_to_pay >= 64) {
      await koh.payForGas(id, 64);
      slots_to_pay = await koh.unpaidSlots(id);
    }
    if (slots_to_pay > 0) {
      await koh.payForGas(id, slots_to_pay);
    }
    await koh.castVotesForApproval(id);
    await koh.castVotesForRejection(id);

    increaseTime(proposals_initial_period);
    await koh.updateProposalState(id);
    let ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_INACTIVE, "Ballot box state is not Inactive!");
    let proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_REJECTED, "Proposal state is not Rejected!");
  });

  it("correct voting", async() => {
    await koh.setOwnerAllSlots();
    let slots_to_pay = await koh.unpaidSlots(id);
    while (slots_to_pay >= 64) {
      await koh.payForGas(id, 64);
      slots_to_pay = await koh.unpaidSlots(id);
    }
    if (slots_to_pay > 0) {
      await koh.payForGas(id, slots_to_pay);
    }

    let votes_num = await koh.castVotesForApproval.call(id);
    await koh.castVotesForApproval(id);
    for (i = 0; i < votes_num; ++i) {
      let vote = await koh.getVote(id, i);
      assert.equal(vote, VOTE_YES, "Incorrect vote! Vote must be positive");
    }

    votes_num = await koh.castVotesForRejection.call(id);
    await koh.castVotesForRejection(id);
    for (i = 0; i < votes_num; ++i) {
      let vote = await koh.getVote(id, i);
      assert.equal(vote, VOTE_NO, "Incorrect vote! Vote must be negative");
    }
  });

  it("contested then rejection", async() => {
    await koh.setOwnerAllSlots();
    let slots_to_pay = await koh.unpaidSlots(id);
    while (slots_to_pay >= 64) {
      await koh.payForGas(id, 64);
      slots_to_pay = await koh.unpaidSlots(id);
    }
    if (slots_to_pay > 0) {
      await koh.payForGas(id, slots_to_pay);
    }

    await koh.castVotesForApproval(id);
    increaseTime(proposals_initial_period);
    await koh.updateProposalState(id);
    let ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    let proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_ACCEPTED, "Proposal state is not Accepted!");

    // Vote negative to enter contested state
    await koh.castVotesForRejection(id);
    await koh.updateProposalState(id);
    ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    proposal = await koh.getProposalData(id);

    assert.equal(proposal.state, PROPOSAL_STATE_CONTESTED, "Proposal state is not Contested!");

    // Wait for contest to end
    increaseTime(proposals_contest_period);
    await koh.updateProposalState(id);
    ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_INACTIVE, "Ballot box state is not Inactive!");
    proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_REJECTED, "Proposal state is not Rejected!");
  });

  it("contested then approval", async() => {
    await koh.setOwnerAllSlots();
    let slots_to_pay = await koh.unpaidSlots(id);
    while (slots_to_pay >= 64) {
      await koh.payForGas(id, 64);
      slots_to_pay = await koh.unpaidSlots(id);
    }
    if (slots_to_pay > 0) {
      await koh.payForGas(id, slots_to_pay);
    }

    await koh.castVotesForApproval(id);
    await koh.updateProposalState(id);
    increaseTime(proposals_initial_period);
    await koh.updateProposalState(id);
    let ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    let proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_ACCEPTED, "Proposal state is not Accepted!");

    // Vote negative to enter contested state
    await koh.castVotesForRejection(id);
    await koh.updateProposalState(id);
    ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_CONTESTED, "Proposal state is not Contested!");

    // Vote positive
    await koh.castVotesForApproval(id);
    await koh.updateProposalState(id);
    // States shouldn't change until the end of contest
    ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_CONTESTED, "Proposal state is not Contested!");
    vote_difference = await koh.calcVoteDifference(id);

    // Wait for contest to end
    increaseTime(proposals_contest_period);
    await koh.updateProposalState(id);
    ballot = await koh.getBallotBox(id);
    assert.equal(ballot.state, BALLOT_STATE_ACTIVE, "Ballot box state is not Active!");
    proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_ACCEPTED, "Proposal state is not Accepted!");
  });
});

describe('TestKingAutomatonProposals claiming reward', async() => {
  const KingAutomaton = artifacts.require("KingAutomaton");

  beforeEach(async() => {
    accounts = await web3.eth.getAccounts();
    account = accounts[0];
    slots = 4;
    treasury_percentage = 2;
    budget_period_len = 300;
    num_periods = 2;
    budget_per_period = 20;

    // Deploy contract and create proposal.
    koh = await KingAutomaton.new(slots, 16, "0x010000", "406080000", 10, -10, treasury_percentage,
        PROPOSALS_INITIAL_PERIOD, PROPOSALS_CONTEST_PERIOD, PROPOSALS_MIN_PERIOD_LEN,
        NUM_HISTORY_PERIODS, TIME_UNIT_IN_SECONDS);
    await koh.setOwnerAllSlots();
    id = await koh.createProposal.call(account, "", "", "0x", budget_period_len, num_periods, budget_per_period);
    await koh.createProposal(account, "", "", "0x", budget_period_len, num_periods, budget_per_period);
    await koh.payForGas(id, slots - 1);
    await koh.updateProposalState(id);

    proposals_initial_period = 1 * await koh.proposalsInitialPeriod();
    proposals_contest_period = 1 * await koh.proposalsContestPeriod();

    treasury_address = "0x0000000000000000000000000000000000000001";
    proposal_address = "0x0000000000000000000000000000000000000064";
  });

  it("correct initialization", async() => {
    assert.equal(id.toNumber(), 100, "Proposal id is not 100!");
    let treasury_balance = new BN(await koh.balances(treasury_address));
    let proposal_balance = new BN(await koh.balances(proposal_address));
    let expected_treasury_balance = new BN("1000000000000000000000000") - 40;
    assert.equal(treasury_balance, expected_treasury_balance, "Inaccurate treasury balance!");
    assert.equal(proposal_balance.toNumber(), 40, "Inaccurate proposal balance!");
  });

  it("claim wrong proposal state", async() => {
    await koh.castVotesForApproval(id);
    let proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_STARTED, "State is not Started!");
    await catchRevert(koh.claimReward(id, budget_per_period), "Incorrect proposal state!");

    increaseTime(proposals_initial_period);
    await koh.castVotesForRejection(id);
    increaseTime(proposals_contest_period);
    await koh.updateProposalState(id);

    proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_REJECTED, "State is not Rejected!");
    await catchRevert(koh.claimReward(id, budget_per_period), "Incorrect proposal state!");
  });

  it("claim all", async() => {
    await koh.updateProposalState(id);
    await koh.castVotesForApproval(id);
    increaseTime(proposals_initial_period);

    let treasury_balance1 = new BN(await koh.balances(treasury_address));
    let proposal_balance1 = new BN(await koh.balances(proposal_address));
    let acc_balance1 = new BN(await koh.balances(account));
    await koh.claimReward(id, budget_per_period);  // First award claiming
    let treasury_balance2 = new BN(await koh.balances(treasury_address));
    let proposal_balance2 = new BN(await koh.balances(proposal_address));
    let acc_balance2 = new BN(await koh.balances(account));

    assert.equal(treasury_balance1.toString(), treasury_balance2.toString(), "Incorrect treasury balance! (0)");
    assert.equal((proposal_balance1.sub(proposal_balance2)).toString(), budget_per_period.toString(), "Incorrect proposal balance! (0)");
    assert.equal((acc_balance2.sub(acc_balance1)).toString(), budget_per_period.toString(), "Incorrect account balance! (0)");

    await koh.claimReward(id, budget_per_period);  // Attempt
    let treasury_balance3 = new BN(await koh.balances(treasury_address));
    let proposal_balance3 = new BN(await koh.balances(proposal_address));
    let acc_balance3 = new BN(await koh.balances(account));

    // Nothing should have changed
    assert.equal(treasury_balance2.toString(), treasury_balance3.toString(), "Incorrect treasury balance!(1)");
    assert.equal(proposal_balance2.toString(), proposal_balance3.toString(), "Incorrect proposal balance!(1)");
    assert.equal(acc_balance2.toString(), acc_balance3.toString(), "Incorrect account balance!(1)");

    increaseTime(budget_period_len * TIME_UNIT_IN_SECONDS + 1);

    await koh.claimReward(id, budget_per_period);

    treasury_balance3 = new BN(await koh.balances(treasury_address));
    proposal_balance3 = new BN(await koh.balances(proposal_address));
    acc_balance3 = new BN(await koh.balances(account));

    assert.equal(treasury_balance2.toString(), treasury_balance3.toString(), "Incorrect treasury balance! (2)");
    assert.equal((proposal_balance2.sub(proposal_balance3)).toString(), budget_per_period.toString(), "Incorrect proposal balance! (2)");
    assert.equal((acc_balance3.sub(acc_balance2)).toString(), budget_per_period.toString(), "Incorrect account balance! (2)");
    assert.equal(proposal_balance3.toNumber(), 0, "Proposal balance should be 0!");

    await catchRevert(koh.claimReward(id, budget_per_period), "Incorrect proposal state!");
    increaseTime(budget_period_len * TIME_UNIT_IN_SECONDS + 1);
    let proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_COMPLETED, "State is not Completed!");
  });

  it("claim bigger reward", async() => {
    await koh.updateProposalState(id);
    await koh.castVotesForApproval(id);
    increaseTime(proposals_initial_period);

    let treasury_balance1 = new BN(await koh.balances(treasury_address));
    let proposal_balance1 = new BN(await koh.balances(proposal_address));
    let acc_balance1 = new BN(await koh.balances(account));
    await catchRevert(koh.claimReward(id, budget_per_period * 2), "Budget exceeded!");
    let treasury_balance2 = new BN(await koh.balances(treasury_address));
    let proposal_balance2 = new BN(await koh.balances(proposal_address));
    let acc_balance2 = new BN(await koh.balances(account));

    // // Nothing should have changed
    assert.equal(treasury_balance2.toString(), treasury_balance1.toString(), "Incorrect treasury balance!(0)");
    assert.equal(proposal_balance2.toString(), proposal_balance1.toString(), "Incorrect proposal balance!(0)");
    assert.equal(acc_balance2.toString(), acc_balance1.toString(), "Incorrect account balance!(0)");

    await koh.claimReward(id, budget_per_period / 2);  // Claim smaller reward
    treasury_balance2 = new BN(await koh.balances(treasury_address));
    proposal_balance2 = new BN(await koh.balances(proposal_address));
    acc_balance2 = new BN(await koh.balances(account));

    assert.equal((treasury_balance2.sub(treasury_balance1)).toNumber(), (budget_per_period / 2), "Incorrect treasury balance!(1)");
    assert.equal((proposal_balance1.sub(proposal_balance2)).toNumber(), budget_per_period, "Incorrect proposal balance!(1)");
    assert.equal((acc_balance2.sub(acc_balance1)).toNumber(), (budget_per_period / 2), "Incorrect account balance!(1)");

    increaseTime(budget_period_len * TIME_UNIT_IN_SECONDS + 1);
    await koh.claimReward(id, budget_per_period / 4);  // Claim some reward for last time
    let treasury_balance3 = new BN(await koh.balances(treasury_address));
    let proposal_balance3 = new BN(await koh.balances(proposal_address));
    let acc_balance3 = new BN(await koh.balances(account));

    assert.equal((treasury_balance3.sub(treasury_balance2)).toNumber(), (budget_per_period * 3 / 4), "Incorrect treasury balance!(2)");
    assert.equal(proposal_balance3.toNumber(), 0, "Incorrect proposal balance!(2)");
    assert.equal((acc_balance3.sub(acc_balance2)).toNumber(), (budget_per_period / 4), "Incorrect account balance!(2)");
  });

  it("create proposal with bigger reward than the %", async() => {
    let treasury_balance = new BN(await koh.balances(treasury_address));
    let max_budget = (treasury_balance.mul(new BN(treasury_percentage))).div(new BN(100));
    let budget = (max_budget.div(new BN(num_periods))).mul(new BN(2));
    await catchRevert(koh.createProposal.call(account, "", "", "0x", budget_period_len, num_periods, budget));
  });

  it("rejected / inactive contributor", async() => {
    let treasury_balance1 = new BN(await koh.balances(treasury_address));
    let proposal_balance1 = new BN(await koh.balances(proposal_address));
    let acc_balance1 = new BN(await koh.balances(account));

    await koh.castVotesForRejection(id);
    increaseTime(proposals_initial_period);
    await koh.updateProposalState(id);

    let proposal = await koh.getProposalData(id);
    assert.equal(proposal.state, PROPOSAL_STATE_REJECTED, "State is not Rejected!");

    let treasury_balance2 = new BN(await koh.balances(treasury_address));
    let proposal_balance2 = new BN(await koh.balances(proposal_address));
    let acc_balance2 = new BN(await koh.balances(account));

    // // Nothing should have changed
    assert.equal((treasury_balance2.sub(treasury_balance1)).toNumber(), (num_periods * budget_per_period), "Incorrect treasury balance!");
    assert.equal(proposal_balance1.toNumber(), (num_periods * budget_per_period), "Incorrect proposal balance! (0)");
    assert.equal(proposal_balance2.toNumber(), 0, "Incorrect proposal balance! (1)");
  });

  it("missed period", async() => {
    await koh.castVotesForApproval(id);
    increaseTime(proposals_initial_period);
    await koh.updateProposalState(id);

    let treasury_balance1 = new BN(await koh.balances(treasury_address));
    let proposal_balance1 = new BN(await koh.balances(proposal_address));
    let acc_balance1 = new BN(await koh.balances(account));
    increaseTime(budget_period_len * TIME_UNIT_IN_SECONDS + 1); // One missed period

    await catchRevert(koh.claimReward(id, budget_per_period * 2), "Budget exceeded!");
    await koh.claimReward(id, budget_per_period);

    let proposal = await koh.getProposalData(id);
    let p_remaining_periods = proposal.remainingPeriods;
    assert.equal(p_remaining_periods, 0, "Incorrect remaining periods!");
    assert.equal(proposal.state, PROPOSAL_STATE_COMPLETED, "State is not Completed!");

    await catchRevert(koh.claimReward(id, budget_per_period), "Incorrect proposal state!");  // State must be completed!

    let treasury_balance2 = new BN(await koh.balances(treasury_address));
    let proposal_balance2 = new BN(await koh.balances(proposal_address));
    let acc_balance2 = new BN(await koh.balances(account));

    assert.equal((treasury_balance2.sub(treasury_balance1)).toNumber(), budget_per_period, "Incorrect treasury balance!");
    assert.equal(proposal_balance2.toNumber(), 0, "Incorrect proposal balance!");
    assert.equal((acc_balance2.sub(acc_balance1)).toNumber(), budget_per_period, "Incorrect account balance!");
  });

  it("missed all periods", async() => {
    let account2 = accounts[1];

    await koh.castVotesForApproval(id);
    increaseTime(proposals_initial_period);
    await koh.updateProposalState(id);

    let treasury_balance1 = new BN(await koh.balances(treasury_address));
    let proposal_balance1 = new BN(await koh.balances(proposal_address));
    let acc_balance1 = new BN(await koh.balances(account));

    increaseTime(budget_period_len * TIME_UNIT_IN_SECONDS * num_periods + 1);  // All periods are missed
    await koh.claimReward(id, budget_per_period, {from:account2});

    let treasury_balance2 = new BN(await koh.balances(treasury_address));
    let proposal_balance2 = new BN(await koh.balances(proposal_address));
    let acc_balance2 = new BN(await koh.balances(account));

    assert.equal((treasury_balance2.sub(treasury_balance1)).toNumber(), budget_per_period * num_periods, "Incorrect treasury balance!");
    assert.equal((proposal_balance1.sub(proposal_balance2)).toNumber(), budget_per_period * num_periods, "Incorrect proposal balance!");
    assert.equal(acc_balance1.toString(), acc_balance2.toString(), "Incorrect account balance!");
  });
});

describe('TestKingAutomatonProposals voting history 5 periods (1 word)', async() => {
  const KingAutomaton = artifacts.require("KingAutomaton");

  beforeEach(async() => {
    accounts = await web3.eth.getAccounts();
    account = accounts[0];
    slots = 4;
    num_periods = 5;

    // Deploy contract and create proposal.
    koh = await KingAutomaton.new(slots, 16, "0x010000", "406080000", 10, -10, 2,
        PROPOSALS_INITIAL_PERIOD, PROPOSALS_CONTEST_PERIOD, PROPOSALS_MIN_PERIOD_LEN,
        num_periods, TIME_UNIT_IN_SECONDS);
    proposals_initial_period = 1 * await koh.proposalsInitialPeriod();

    await koh.setOwnerAllSlots();
    id = await koh.createProposal.call(account, "", "", "0x", 30, 3, 20);
    await koh.createProposal(account, "", "", "0x", 30, 3, 20);
    await koh.payForGas(id, slots - 1);
    await koh.castVote(id, 0, 1);  // 25% / 125
    increaseTime(proposals_initial_period);
    await koh.updateProposalState(id);
  });

  it("period history", async() => {
    let proposal = await koh.getProposalData(id);
    let history = new BN(proposal.votingHistory[0]);
    assert.equal("7d", history.toString(16), "Incorrect voting history! (0)");

    increaseTime(TIME_UNIT_IN_SECONDS);
    await koh.castVote(id, 2, 1);  // 50% / 150
    proposal = await koh.getProposalData(id);
    history = new BN(proposal.votingHistory[0]);
    assert.equal("960000007d", history.toString(16), "Incorrect voting history! (1)");

    increaseTime(TIME_UNIT_IN_SECONDS);
    await koh.castVote(id, 2, 2);  // 0% / 100
    proposal = await koh.getProposalData(id);
    history = new BN(proposal.votingHistory[0]);
    assert.equal("966400007d", history.toString(16), "Incorrect voting history! (2)");

    increaseTime(TIME_UNIT_IN_SECONDS);
    await koh.castVote(id, 3, 1);  // 25% / 125
    proposal = await koh.getProposalData(id);
    history = new BN(proposal.votingHistory[0]);
    assert.equal("96647d007d", history.toString(16), "Incorrect voting history! (3)");

    increaseTime(TIME_UNIT_IN_SECONDS);
    await koh.castVote(id, 0, 2);  // -25% / 75
    proposal = await koh.getProposalData(id);
    history = new BN(proposal.votingHistory[0]);
    assert.equal("96647d4b7d", history.toString(16), "Incorrect voting history! (4)");

    increaseTime(TIME_UNIT_IN_SECONDS);
    await koh.castVote(id, 1, 1);  // 0% / 100
    proposal = await koh.getProposalData(id);
    history = new BN(proposal.votingHistory[0]);
    assert.equal("96647d4b64", history.toString(16), "Incorrect voting history! (5)");

    increaseTime(TIME_UNIT_IN_SECONDS);
    await koh.castVote(id, 1, 2);  // -50% / 50
    proposal = await koh.getProposalData(id);
    history = new BN(proposal.votingHistory[0]);
    assert.equal("32647d4b64", history.toString(16), "Incorrect voting history! (6)");
  });

  it("period history 2", async() => {
    await koh.castVote(id, 1, 1);
    let proposal = await koh.getProposalData(id);
    let history = new BN(proposal.votingHistory[0]);
    assert.equal("960000007d", history.toString(16), "Incorrect voting history! (0)");

    await koh.castVote(id, 2, 1);  // Change vote difference, but time passed < period
    proposal = await koh.getProposalData(id);
    history = new BN(proposal.votingHistory[0]);
    assert.equal("960000007d", history.toString(16), "History should not have changed! 0");

    increaseTime(TIME_UNIT_IN_SECONDS);
    await koh.castVote(id, 2, 1);  // Update history - the new value should be added
    proposal = await koh.getProposalData(id);
    let calc_difference = new BN((await koh.calcVoteDifference(id)) * 1 + 100);
    history = new BN(proposal.votingHistory[0]);
    assert.equal("96af00007d", history.toString(16), "Incorrect voting history! (1)");

    // Increase time but keep the vote difference the same
    increaseTime(TIME_UNIT_IN_SECONDS * 3);
    proposal = await koh.getProposalData(id);
    history = new BN(proposal.votingHistory[0]);
    assert.equal("96af00007d", history.toString(16), "History should not have changed! 1");
  });
});

describe('TestKingAutomatonProposals voting history 35 periods (2 words)', async() => {
  const KingAutomaton = artifacts.require("KingAutomaton");

  beforeEach(async() => {
    accounts = await web3.eth.getAccounts();
    account = accounts[0];
    slots = 4;
    num_periods = 35;

    // Deploy contract and create proposal.
    koh = await KingAutomaton.new(slots, 16, "0x010000", "406080000", 10, -100, 2,
        PROPOSALS_INITIAL_PERIOD, PROPOSALS_CONTEST_PERIOD, PROPOSALS_MIN_PERIOD_LEN,
        num_periods, TIME_UNIT_IN_SECONDS);
    proposals_initial_period = 1 * await koh.proposalsInitialPeriod();

    await koh.setOwnerAllSlots();
    id = await koh.createProposal.call(account, "", "", "0x", 30, 3, 20);
    await koh.createProposal(account, "", "", "0x", 30, 3, 20);
    await koh.payForGas(id, slots - 1);
    await koh.castVote(id, 0, 1);  // 25% / 125
    increaseTime(proposals_initial_period);
    await koh.updateProposalState(id);
  });

  it("period history", async() => {
    let proposal = await koh.getProposalData(id);
    let calc_difference = new BN((await koh.calcVoteDifference(id)) * 1 + 100);
    let history = [calc_difference];
    let idx = 0;
    let value = 0;
    let offset = 0;
    let mask = 0;
    let word = 0;

    for (i = 1; i <= 36; i++) {
      increaseTime(TIME_UNIT_IN_SECONDS);
      await koh.castVote(id, i % slots, (i + Math.floor(i / slots)) % 2 + 1);
      proposal = await koh.getProposalData(id);
      idx = new BN(proposal.historyStartIdx);
      calc_difference = new BN((await koh.calcVoteDifference(id)) * 1 + 100);
      history.push(calc_difference.toString(16));
      let word_idx = Math.floor(idx.toNumber() / 32);
      word = new BN(proposal.votingHistory[word_idx]);
      offset = (idx % 32) * 8;
      mask = new BN(255);
      mask.iushln(offset);
      value = word.and(mask);
      value.iushrn(offset);
      assert.equal(value.toString(16), calc_difference.toString(16), "Incorrect value @ step " + i.toString());
    }
  });
});
