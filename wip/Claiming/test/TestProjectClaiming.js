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
let getTime = utils.getTime;

async function claim_and_withdraw_ind_test(individual, sponsor, amount_to_claim,
    expected_balance_sponsor, expected_reward, msg) {
  await sponsor.claim(amount_to_claim, {from: individual});
  let balance1 = await sponsor.balances(individual);
  assert.equal(balance1.toNumber(), expected_reward, "Incorrect balance! (0) --> " + msg);

  let balance_before_withdraw = new BN(await web3.eth.getBalance(individual));
  let sponsor_balance1 = new BN(await web3.eth.getBalance(sponsor.address));
  assert.equal(sponsor_balance1.toString(), expected_balance_sponsor.toString(), "Incorrect balance! (1) --> " + msg);
  let txReceipt = await sponsor.withdraw(expected_reward, {from: individual});
  let sponsor_balance2 = new BN(await web3.eth.getBalance(sponsor.address));
  let gasUsed = new BN(txReceipt.receipt.gasUsed);
  let tx = await web3.eth.getTransaction(txReceipt.tx);
  let gasPrice = new BN(tx.gasPrice);

  assert.equal(sponsor_balance1.sub(sponsor_balance2).toNumber(), expected_reward, "Incorrect balance! (2) --> " + msg);
  let balance_after_withdraw = new BN(await web3.eth.getBalance(individual));
  let expected_balance = balance_before_withdraw.add(new BN(expected_reward)).sub(gasUsed.mul(gasPrice));
  assert.equal(balance_after_withdraw.toString(), expected_balance.toString(), "Incorrect balance! (3) --> " + msg);
}

async function claim_and_withdraw_prj_test(subproject, sponsor, expected_balance,
    expected_balance_sponsor, expected_reward, msg) {
  let balance_before_withdraw = new BN(await web3.eth.getBalance(subproject.address));
  assert.equal(balance_before_withdraw.toString(), expected_balance.toString(), "Incorrect balance! (0) --> " + msg);
  let sponsor_balance1 = new BN(await web3.eth.getBalance(sponsor.address));
  assert.equal(sponsor_balance1.toString(), expected_balance_sponsor.toString(), "Incorrect balance! (1) --> " + msg);
  await subproject.claimAndWithdrawFromSponsor();
  let sponsor_balance2 = new BN(await web3.eth.getBalance(sponsor.address));
  assert.equal(sponsor_balance1.sub(sponsor_balance2).toNumber(), expected_reward, "Incorrect balance! (2) --> " + msg);
  let balance_after_withdraw = new BN(await web3.eth.getBalance(subproject.address));
  assert.equal((balance_after_withdraw.sub(balance_before_withdraw)).toNumber(), expected_reward, "Incorrect balance! (3) --> " + msg);
}

async function return_to_sponsor_test(project, expected_balance, should_return, expected_amount_to_return, expected_date, msg) {
  let nextClaimDate1 = new BN(await project.nextClaimDate());
  assert.equal(nextClaimDate1.toNumber(), expected_date, "Incorrect date! (0) --> " + msg);
  let balance1 = new BN(await web3.eth.getBalance(project.address));
  assert.equal(balance1.toNumber(), expected_balance, "Incorrect balance! (0) --> " + msg);
  await project.returnUnusedToSponsor();
  let nextClaimDate2 = new BN(await project.nextClaimDate());
  let balance2 = new BN(await web3.eth.getBalance(project.address));
  if (should_return) {
    assert.equal(nextClaimDate2.toNumber(), 0, "Incorrect date! (1) --> " + msg);
    assert.equal(balance1.sub(balance2).toNumber(), expected_amount_to_return, "Incorrect balance! (1) --> " + msg);
  } else {
    assert.equal(nextClaimDate2.toNumber(), nextClaimDate1.toNumber(), "Incorrect date! (2) --> " + msg);
    assert.equal(balance2.toNumber(), balance1.toNumber(), "Incorrect balance! (2) --> " + msg);
  }
}

async function test_balances(address, sponsor, expected_balance, msg) {
  let balance = new BN(await sponsor.balances(address));
  assert.equal(balance.toString(), expected_balance.toString(), "Incorrect balance! --> " + msg);
}

async function test_balances2(address, sponsor, expected_balance, expected_balance_sponsor, msg) {
  let balance = new BN(await sponsor.balances(address));
  assert.equal(balance.toString(), expected_balance.toString(), "Incorrect balance! (0) --> " + msg);
  balance = new BN(await web3.eth.getBalance(sponsor.address));
  assert.equal(balance.toString(), expected_balance_sponsor.toString(), "Incorrect balance! (1) --> " + msg);
}

async function withdraw_test(individual, sponsor, expected_balance_sponsor, value_to_withdraw, msg) {
  let balance_before_withdraw = new BN(await web3.eth.getBalance(individual));
  let sponsor_balance1 = new BN(await web3.eth.getBalance(sponsor.address));
  assert.equal(sponsor_balance1.toString(), expected_balance_sponsor.toString(), "Incorrect balance! (0) --> " + msg);
  let txReceipt = await sponsor.withdraw(value_to_withdraw, {from: individual});
  let sponsor_balance2 = new BN(await web3.eth.getBalance(sponsor.address));
  let gasUsed = new BN(txReceipt.receipt.gasUsed);
  let tx = await web3.eth.getTransaction(txReceipt.tx);
  let gasPrice = new BN(tx.gasPrice);

  assert.equal(sponsor_balance1.sub(sponsor_balance2).toNumber(), value_to_withdraw, "Incorrect balance! (1) --> " + msg);
  let balance_after_withdraw = new BN(await web3.eth.getBalance(individual));
  let expected_balance = balance_before_withdraw.add(new BN(value_to_withdraw)).sub(gasUsed.mul(gasPrice));
  assert.equal(balance_after_withdraw.toString(), expected_balance.toString(), "Incorrect balance! (2) --> " + msg);
}

describe('ProjectClaimingTest1', async() => {
  const TestSponsor = artifacts.require("TestSponsor");
  const Project = artifacts.require("ProjectClaiming");
  const PERIOD_LENGTH = 604800;  // 1 week

  beforeEach(async() => {
    accounts = await web3.eth.getAccounts();
    account = accounts[0];
    periodsLeft = 3;
    let now = await getTime();
    nextClaimDate = now + PERIOD_LENGTH;

    test_sponsor = await TestSponsor.new(nextClaimDate, periodsLeft, 1500000, 0, 0);

    /*
    M (1500/m)
      |-A (100/m) (individual)
      |-B (500/m + 200 one-time) (project)
        |-B1 (100/m) (individual)
        |-B2 (100 one-time + 50 bonus) (individual)
        |-B3 (400/m) (project)
          |- B3_A (100/m) (individual)
          |- B3_B (100/m + 150 bonus) (individual)
      |-C (400 one-time) (project)
        |-C1 (50/m + 50 one-time + 50 bonus) (individual)
        |-C2 (100 one-time + 50 bonus) (individual)
      |-D (200 one-time) (individual)
    */

    individual_A = accounts[1];
    individual_B1 = accounts[2];
    individual_B2 = accounts[3];
    individual_B3A = accounts[4];
    individual_B3B = accounts[5];
    individual_C1 = accounts[6];
    individual_C2 = accounts[7];
    individual_D = accounts[8];

    main_project = await Project.new(test_sponsor.address, periodsLeft, 1500000, nextClaimDate);
    await test_sponsor.setSponsoredProject(main_project.address);

    await web3.eth.sendTransaction({from: account, to: test_sponsor.address, value: 5000000});

    await main_project.addContributor(individual_A, false, 0, nextClaimDate, periodsLeft, 100000, 0, 0);

    subproject_b = await Project.new(main_project.address, periodsLeft, 500000, nextClaimDate);
    await subproject_b.addContributor(individual_B1, false, 0, nextClaimDate, periodsLeft, 100000, 0, 0);
    await subproject_b.addContributor(individual_B2, false, 0, nextClaimDate, periodsLeft, 0, 100000, 50000);

    subproject_b3 = await Project.new(subproject_b.address, periodsLeft, 400000, nextClaimDate);
    await subproject_b3.addContributor(individual_B3A, false, 0, nextClaimDate, periodsLeft, 100000, 0, 0);
    await subproject_b3.addContributor(individual_B3B, false, 0, nextClaimDate, periodsLeft, 100000, 0, 150000);

    await subproject_b.addContributor(subproject_b3.address, true, 0, nextClaimDate, periodsLeft, 400000, 0, 0);
    await main_project.addContributor(subproject_b.address, true, 0, nextClaimDate, periodsLeft, 500000, 200000, 0);

    subproject_c = await Project.new(main_project.address, periodsLeft, 0, nextClaimDate);
    await subproject_c.addContributor(individual_C1, false, 0, nextClaimDate, periodsLeft, 50000, 50000, 50000);
    await subproject_c.addContributor(individual_C2, false, 0, nextClaimDate, periodsLeft, 0, 100000, 50000);
    await main_project.addContributor(subproject_c.address, true, 0, nextClaimDate, periodsLeft, 0, 400000, 0);

    await main_project.addContributor(individual_D, false, 0, nextClaimDate, periodsLeft, 0, 200000, 0);
  });

  it("missed periods", async() => {
    let claimDate1 = new BN(await main_project.nextClaimDate());
    let claimDate2 = new BN(await subproject_c.nextClaimDate());
    let periodsLeft1 = new BN(await main_project.periodsLeft());
    let periodsLeft2 = new BN(await subproject_c.periodsLeft());
    assert.equal(claimDate1.toNumber(), claimDate2.toNumber(), "Incorrect nextClaimDate! (0)");
    assert.equal(claimDate1.toNumber(), nextClaimDate, "Incorrect nextClaimDate! (1)");
    assert.equal(periodsLeft1.toNumber(), periodsLeft2.toNumber(), "Incorrect periodsLeft! (0)");
    assert.equal(periodsLeft1.toNumber(), periodsLeft, "Incorrect periodsLeft! (1)");

    await increaseTime(PERIOD_LENGTH * 2 + 5);
    main_project.checkForMissedPeriods();  // Main project missed 1 period
    claimDate1 = new BN(await main_project.nextClaimDate());
    claimDate2 = new BN(await subproject_c.nextClaimDate());
    periodsLeft1 = new BN(await main_project.periodsLeft());
    periodsLeft2 = new BN(await subproject_c.periodsLeft());
    assert.equal(claimDate1.toNumber(), nextClaimDate + PERIOD_LENGTH, "Incorrect nextClaimDate! (2)");
    assert.equal(claimDate2.toNumber(), nextClaimDate, "Incorrect nextClaimDate! (3)");
    assert.equal(periodsLeft1.toNumber(), periodsLeft - 1, "Incorrect periodsLeft! (2)");
    assert.equal(periodsLeft2.toNumber(), periodsLeft, "Incorrect periodsLeft! (3)");

    await increaseTime(PERIOD_LENGTH);
    subproject_c.checkForMissedPeriods();  // Project C missed 2 period
    claimDate1 = new BN(await main_project.nextClaimDate());
    claimDate2 = new BN(await subproject_c.nextClaimDate());
    periodsLeft1 = new BN(await main_project.periodsLeft());
    periodsLeft2 = new BN(await subproject_c.periodsLeft());
    assert.equal(claimDate1.toNumber(), nextClaimDate + PERIOD_LENGTH, "Incorrect nextClaimDate! (4)");
    assert.equal(claimDate2.toNumber(), nextClaimDate + 2*PERIOD_LENGTH, "Incorrect nextClaimDate! (5)");
    assert.equal(periodsLeft1.toNumber(), periodsLeft - 1, "Incorrect periodsLeft! (4)");
    assert.equal(periodsLeft2.toNumber(), periodsLeft - 2, "Incorrect periodsLeft! (5)");

    await increaseTime(PERIOD_LENGTH);
    main_project.checkForMissedPeriods();  // Main project missed 2 periods, total 3 periods (all periods)
    subproject_c.checkForMissedPeriods();  // Project C missed 1 period, total 3 periods (all periods)
    claimDate1 = new BN(await main_project.nextClaimDate());
    claimDate2 = new BN(await subproject_c.nextClaimDate());
    periodsLeft1 = new BN(await main_project.periodsLeft());
    periodsLeft2 = new BN(await subproject_c.periodsLeft());
    assert.equal(claimDate1.toNumber(), 0, "Incorrect nextClaimDate! (6)");
    assert.equal(claimDate2.toNumber(), 0, "Incorrect nextClaimDate! (7)");
    assert.equal(periodsLeft1.toNumber(), 0, "Incorrect periodsLeft! (6)");
    assert.equal(periodsLeft2.toNumber(), 0, "Incorrect periodsLeft! (7)");
  });

  it("Correct creation, initial balances and claims", async() => {
    let sponsor_address = await main_project.sponsor();
    assert.equal(sponsor_address, test_sponsor.address, "Incorrect sponsor!");
    let claimDate1 = new BN(await main_project.nextClaimDate());
    let claimDate2 = new BN(await test_sponsor.nextClaimDate());
    assert.equal(claimDate1.toString(), claimDate2.toString(), "Incorrect nextClaimDate!");

    // main project
    let reward_per_period = new BN(await main_project.rewardPerPeriod());
    let sponsor_reward_per_period = new BN(await test_sponsor.rewardPerPeriod());
    assert.equal(reward_per_period.toNumber(), sponsor_reward_per_period.toNumber(), "Incorrect creation! (0)");
    assert.equal(reward_per_period.toNumber(), 1500000, "Incorrect creation! (1)");

    // individual_A
    let contributor = await main_project.contributors(individual_A);
    assert.equal(contributor.rewardPerPeriod.toNumber(), 100000, "Incorrect creation! (2)");
    assert.equal(contributor.oneTimeReward.toNumber(), 0, "Incorrect creation! (3)");
    assert.equal(contributor.bonus.toNumber(), 0, "Incorrect creation! (4)");

    // project B
    contributor = await main_project.contributors(subproject_b.address);
    reward_per_period = new BN(await subproject_b.rewardPerPeriod());
    assert.equal(reward_per_period.toNumber(), 500000, "Incorrect creation! (5)");
    assert.equal(contributor.rewardPerPeriod.toNumber(), 500000, "Incorrect creation! (6)");
    assert.equal(contributor.oneTimeReward.toNumber(), 200000, "Incorrect creation! (7)");
    assert.equal(contributor.bonus.toNumber(), 0, "Incorrect creation! (8)");

    // individual_C1
    contributor = await subproject_c.contributors(individual_C1);
    assert.equal(contributor.rewardPerPeriod.toNumber(), 50000, "Incorrect creation! (9)");
    assert.equal(contributor.oneTimeReward.toNumber(), 50000, "Incorrect creation! (10)");
    assert.equal(contributor.bonus.toNumber(), 50000, "Incorrect creation! (11)");

    let sponsor_balance = new BN(await web3.eth.getBalance(test_sponsor.address));
    assert.equal(sponsor_balance.toNumber(), 5000000, "Incorrect sponsor balance value!");

    let project_balance = new BN(await web3.eth.getBalance(main_project.address));
    assert.equal(project_balance.toNumber(), 0, "Incorrect balance main project (0)!");

    // 0 to claim, nextClaimDate > now
    await main_project.claimAndWithdrawFromSponsor();
    project_balance = new BN(await web3.eth.getBalance(main_project.address));
    assert.equal(project_balance.toNumber(), 0, "Incorrect balance main project (1)!");

    // 200 000 to claim but main_project balance is 0
    await catchRevert(subproject_b.claimAndWithdrawFromSponsor(), "Withdraw error!");
    project_balance = new BN(await web3.eth.getBalance(subproject_b.address));
    assert.equal(project_balance.toNumber(), 0, "Incorrect subproject_b balance!");

    // 0 to claim, nextClaimDate > now
    subproject_b3.claimAndWithdrawFromSponsor();
    project_balance = new BN(await web3.eth.getBalance(subproject_b3.address));
    assert.equal(project_balance.toNumber(), 0, "Incorrect subproject_b3 balance!");

    // 400 000 to claim but main_project balance is 0
    await catchRevert(subproject_c.claimAndWithdrawFromSponsor(), "Withdraw error!");
    project_balance = new BN(await web3.eth.getBalance(subproject_c.address));
    assert.equal(project_balance.toNumber(), 0, "Incorrect subproject_c balance!");
  });

  it("Correct claiming for all periods without missing a period", async() => {
    let claimDate1 = new BN(await main_project.nextClaimDate());
    let claimDate2 = new BN(await test_sponsor.nextClaimDate());
    assert.equal(claimDate1.toString(), claimDate2.toString(), "Incorrect nextClaimDate! (0)");
    assert.equal(claimDate1.toNumber(), nextClaimDate, "Incorrect nextClaimDate! (1)");

    let timestamp1 = await getTime();

    await increaseTime(PERIOD_LENGTH + 5);
    await main_project.claimAndWithdrawFromSponsor();

    let timestamp2 = await getTime();
    assert.isAtLeast(timestamp2, timestamp1 + PERIOD_LENGTH, "Incorrect date! (0)");
    assert.isAtLeast(timestamp2, nextClaimDate, "Incorrect date! (1)");

    let balance = new BN(await web3.eth.getBalance(main_project.address));
    assert.equal(balance.toNumber(), 1500000, "Incorrect balance main project (0)!");

    /*
    M (1500/m)
      |-A (100/m) (individual)
      |-B (500/m + 200 one-time) (project)
        |-B1 (100/m) (individual)
        |-B2 (100 one-time + 50 bonus) (individual)
        |-B3 (400/m) (project)
          |- B3_A (100/m) (individual)
          |- B3_B (100/m + 150 bonus) (individual)
      |-C (400 one-time) (project)
        |-C1 (50/m + 50 one-time + 50 bonus) (individual)
        |-C2 (100 one-time + 50 bonus) (individual)
      |-D (200 one-time) (individual)
    */
    await claim_and_withdraw_ind_test(individual_A, main_project, 0, 1500000, 100000, "First period: individual_A");
    await claim_and_withdraw_prj_test(subproject_b, main_project, 0, 1400000, 700000, "First period: project_B");
    await claim_and_withdraw_ind_test(individual_B1, subproject_b, 0, 700000, 100000, "First period: individual_B1");
    await claim_and_withdraw_ind_test(individual_B2, subproject_b, 0, 600000, 150000, "First period: individual_B2");
    await claim_and_withdraw_prj_test(subproject_b3, subproject_b, 0, 450000, 400000, "First period: project_B3");
    await claim_and_withdraw_ind_test(individual_B3A, subproject_b3, 0, 400000, 100000, "First period: individual_B3A");
    await claim_and_withdraw_ind_test(individual_B3B, subproject_b3, 0, 300000, 250000, "First period: individual_B3B");
    await claim_and_withdraw_prj_test(subproject_c, main_project, 0, 700000, 400000, "First period: project_C");
    await claim_and_withdraw_ind_test(individual_C1, subproject_c, 0, 400000, 150000, "First period: individual_C1");
    await claim_and_withdraw_ind_test(individual_C2, subproject_c, 0, 250000, 150000, "First period: individual_C2");
    await claim_and_withdraw_ind_test(individual_D, main_project, 0, 300000, 200000, "First period: individual_D");

    await increaseTime(PERIOD_LENGTH);
    balance = new BN(await web3.eth.getBalance(main_project.address));
    assert.equal(balance.toNumber(), 100000, "Incorrect balance!");
    await main_project.claimAndWithdrawFromSponsor();

    await claim_and_withdraw_ind_test(individual_A, main_project, 0, 1500000, 100000, "Second period: individual_A");
    await claim_and_withdraw_prj_test(subproject_b, main_project, 50000, 1400000, 450000, "Second period: project_B");
    await claim_and_withdraw_ind_test(individual_B1, subproject_b, 0, 500000, 100000, "Second period: individual_B1");
    await claim_and_withdraw_ind_test(individual_B2, subproject_b, 0, 400000, 0, "Second period: individual_B2");
    await claim_and_withdraw_prj_test(subproject_b3, subproject_b, 50000, 400000, 350000, "Second period: project_B3");
    await claim_and_withdraw_ind_test(individual_B3A, subproject_b3, 0, 400000, 100000, "Second period: individual_B3A");
    await claim_and_withdraw_ind_test(individual_B3B, subproject_b3, 0, 300000, 100000, "Second period: individual_B3B");
    await claim_and_withdraw_prj_test(subproject_c, main_project, 100000, 950000, 0, "Second period: project_C");
    await claim_and_withdraw_ind_test(individual_C1, subproject_c, 0, 100000, 50000, "Second period: individual_C1");
    await claim_and_withdraw_ind_test(individual_C2, subproject_c, 0, 50000, 0, "Second period: individual_C2");
    await claim_and_withdraw_ind_test(individual_D, main_project, 0, 950000, 0, "Second period: individual_D");

    await increaseTime(PERIOD_LENGTH);
    balance = new BN(await web3.eth.getBalance(main_project.address));
    assert.equal(balance.toNumber(), 950000, "Incorrect balance!");
    await main_project.claimAndWithdrawFromSponsor();

    await claim_and_withdraw_ind_test(individual_A, main_project, 0, 1500000, 100000, "Third/Last period: nindividual_A");
    await claim_and_withdraw_prj_test(subproject_b, main_project, 50000, 1400000, 450000, "Third/Last period: project_B");
    await claim_and_withdraw_ind_test(individual_B1, subproject_b, 0, 500000, 100000, "Third/Last period: individual_B1");
    await claim_and_withdraw_ind_test(individual_B2, subproject_b, 0, 400000, 0, "Third/Last period: individual_B2");
    await claim_and_withdraw_prj_test(subproject_b3, subproject_b, 200000, 400000, 200000, "Third/Last period: project_B3");
    await claim_and_withdraw_ind_test(individual_B3A, subproject_b3, 0, 400000, 100000, "Third/Last period: individual_B3A");
    await claim_and_withdraw_ind_test(individual_B3B, subproject_b3, 0, 300000, 100000, "Third/Last period: individual_B3B");
    await claim_and_withdraw_prj_test(subproject_c, main_project, 50000, 950000, 0, "Third/Last period: project_C");
    await claim_and_withdraw_ind_test(individual_C1, subproject_c, 0, 50000, 50000, "Third/Last period: individual_C1");
    await claim_and_withdraw_ind_test(individual_C2, subproject_c, 0, 0, 0, "Third/Last period: individual_C2");
    await claim_and_withdraw_ind_test(individual_D, main_project, 0, 950000, 0, "Third/Last period: individual_D");

    ////////////// Return unused rewards

    // Nothing happens, another period should pass for rewards to be returned
    await return_to_sponsor_test(main_project, 950000, false, 0, nextClaimDate + 3*PERIOD_LENGTH, "Returning to sponsor (no changes): main_project");
    await return_to_sponsor_test(subproject_b, 200000, false, 0, nextClaimDate + 3*PERIOD_LENGTH, "Returning to sponsor (no changes): project_B");
    await return_to_sponsor_test(subproject_b3, 200000, false, 0, nextClaimDate + 3*PERIOD_LENGTH, "Returning to sponsor (no changes): project_B3");
    await return_to_sponsor_test(subproject_c, 0, false, 0, nextClaimDate + 3*PERIOD_LENGTH, "Returning to sponsor (no changes): project_C");

    await increaseTime(PERIOD_LENGTH);

    // All unused rewards must be returned to their sponsor
    await return_to_sponsor_test(main_project, 950000, true, 950000, nextClaimDate + 3*PERIOD_LENGTH, "All projects return to their sponsor: main project");
    await return_to_sponsor_test(subproject_b, 200000, true, 200000, nextClaimDate + 3*PERIOD_LENGTH, "All projects return to their sponsor: project_B");
    await return_to_sponsor_test(subproject_b3, 200000, true, 200000, nextClaimDate + 3*PERIOD_LENGTH, "All projects return to their sponsor: project_B3");
    await return_to_sponsor_test(subproject_c, 0, true, 0, nextClaimDate + 3*PERIOD_LENGTH, "All projects return to their sponsor: project_C");

    // Return returned
    await return_to_sponsor_test(subproject_b, 200000, true, 200000, 0, "Projects return to sponsor what their subprojects returned to them: project B");
    await return_to_sponsor_test(main_project, 400000, true, 400000, 0, "Projects return to sponsor what their subprojects returned to them: main_project");
  });

  it("Skipping periods", async() => {

    /*
    M (1500/m)
      |-A (100/m) (individual)
      |-B (500/m + 200 one-time) (project)
        |-B1 (100/m) (individual)
        |-B2 (100 one-time + 50 bonus) (individual)
        |-B3 (400/m) (project)
          |- B3_A (100/m) (individual)
          |- B3_B (100/m + 150 bonus) (individual)
      |-C (400 one-time) (project)
        |-C1 (50/m + 50 one-time + 50 bonus) (individual)
        |-C2 (100 one-time + 50 bonus) (individual)
      |-D (200 one-time) (individual)
    */

    await increaseTime(PERIOD_LENGTH + 5);
    await main_project.claimAndWithdrawFromSponsor();
    await increaseTime(PERIOD_LENGTH);
    await main_project.claimAndWithdrawFromSponsor();
    // Project B has missed a period
    // TODO(kari): BUG(kari): project b must pay bonuses but won't have the money
    await claim_and_withdraw_prj_test(subproject_b, main_project, 0,
        3000000, 500000, "Project B missed a period and lost one-time reward of 200k, must only receive monthly reward of 500k!");
    // Project B try to claim again!
    await claim_and_withdraw_prj_test(subproject_b, main_project, 500000, 2500000, 0, "Project B try to claim again!");

    // Individual B2 should only receive their bonus
    await claim_and_withdraw_ind_test(individual_B2, subproject_b, 0, 500000, 50000, "Individual B2 should only receive their bonus!");

    await increaseTime(PERIOD_LENGTH);
    await main_project.claimAndWithdrawFromSponsor();
    // Individual D missed 2 periods and lost their one-time reward
    await claim_and_withdraw_ind_test(individual_D, main_project, 0, 4000000, 0, "Individual D missed 2 periods and lost their one-time reward!");
    await increaseTime(PERIOD_LENGTH);

    // Subproject B3 missed all the periods
    await claim_and_withdraw_prj_test(subproject_b3, subproject_b, 0,
        450000, 0, "Subproject B3 missed all the periods!");
    await return_to_sponsor_test(subproject_b3, 0, false, 0, 0, "Project B3 returning to B3 amount of 0! (0)");
    await return_to_sponsor_test(subproject_b3, 0, true, 0, 0, "Project B3 returning to B3 amount of 0! (1)");

    await return_to_sponsor_test(subproject_b, 450000, true, 450000, 0, "Project B returning to Main amount of 450000!");

    await return_to_sponsor_test(main_project, 4450000, true, 4450000, nextClaimDate + 3*PERIOD_LENGTH, "Project Main returning to sponsor amount of 450000!");
  });

  it("Claim first, withdraw after the end", async() => {
  //   /*
  //   M (1500/m)
  //     |-A (100/m) (individual)
  //     |-B (500/m + 200 one-time) (project)
  //       |-B1 (100/m) (individual)
  //       |-B2 (100 one-time + 50 bonus) (individual)
  //       |-B3 (400/m) (project)
  //         |- B3_A (100/m) (individual)
  //         |- B3_B (100/m + 150 bonus) (individual)
  //     |-C (400 one-time) (project)
  //       |-C1 (50/m + 50 one-time + 50 bonus) (individual)
  //       |-C2 (100 one-time + 50 bonus) (individual)
  //     |-D (200 one-time) (individual)
  //   */
  //   let expected_balance_b3 = 0;
  //   let claimed_b3 = 0;
  //   let expected_balance_b = 0;
  //   let claimed_b = 0;
  //   let expected_balance_c = 0;
  //   let claimed_c = 0;
  //   let expected_balance_main = 0;
  //   let claimed_main = 0;
  //   let indA_claimed = 0;
  //   let indB1_claimed = 0;
  //   let indB2_claimed = 0;
  //   let indB3A_claimed = 0;
  //   let indB3B_claimed = 0;
  //   let indC1_claimed = 0;
  //   let indC2_claimed = 0;
  //   let indD_claimed = 0;
  //
  //   // ===== FIRST PERIOD =====
  //   await increaseTime(PERIOD_LENGTH + 5);
  //   await main_project.claimAndWithdrawFromSponsor();
  //   expected_balance_main += 1500000;
  //   await main_project.claim(0, {from: individual_A});
  //   claimed_main += 100000;
  //   indA_claimed += 100000;
  //   await test_balances(individual_A, main_project, 100000, "First period claim individual_A!");
  //   await subproject_b.claimAndWithdrawFromSponsor();
  //   expected_balance_b += 700000;
  //   expected_balance_main -= 700000;
  //   await subproject_b.claim(0, {from: individual_B1});
  //   claimed_b += 100000;
  //   indB1_claimed += 100000;
  //   await test_balances(individual_B1, subproject_b, 100000, "First period claim individual_B1!");
  //   await subproject_b.claim(0, {from: individual_B2});
  //   claimed_b += 150000;
  //   indB2_claimed += 150000;
  //   await test_balances(individual_B2, subproject_b, 150000, "First period claim individual_B2!");
  //   await subproject_b3.claimAndWithdrawFromSponsor();
  //   expected_balance_b3 += 400000;
  //   expected_balance_b -= 400000;
  //   await subproject_b3.claim(0, {from: individual_B3A});
  //   claimed_b3 += 100000;
  //   indB3A_claimed += 100000;
  //   await test_balances(individual_B3A, subproject_b3, 100000, "First period claim individual_B3A!");
  //   await subproject_b3.claim(0, {from: individual_B3B});
  //   claimed_b3 += 250000;
  //   indB3B_claimed += 250000;
  //   await test_balances(individual_B3B, subproject_b3, 250000, "First period claim individual_B3B!");
  //   await subproject_c.claimAndWithdrawFromSponsor();
  //   expected_balance_c += 400000;
  //   expected_balance_main -= 400000;
  //   await subproject_c.claim(0, {from: individual_C1});
  //   claimed_c += 150000;
  //   indC1_claimed += 150000;
  //   await test_balances(individual_C1, subproject_c, 150000, "First period claim individual_C1!");
  //   await subproject_c.claim(0, {from: individual_C2});
  //   claimed_c += 150000;
  //   indC2_claimed += 150000;
  //   await test_balances(individual_C2, subproject_c, 150000, "First period claim individual_C2!");
  //   await main_project.claim(0, {from: individual_D});
  //   claimed_main += 200000;
  //   indD_claimed += 200000;
  //   await test_balances(individual_D, main_project, 200000, "First period claim individual_D!");
  //
  //   // ===== SECOND PERIOD =====
  //   await increaseTime(PERIOD_LENGTH);
  //   await main_project.claimAndWithdrawFromSponsor();
  //   expected_balance_main += 1500000 - expected_balance_main + claimed_main;
  //   await main_project.claim(0, {from: individual_A});
  //   claimed_main += 100000;
  //   indA_claimed += 100000;
  //   await test_balances(individual_A, main_project, 200000, "Second period claim individual_A!");
  //   await subproject_b.claimAndWithdrawFromSponsor();
  //   let new_reward = 500000 - expected_balance_b + claimed_b;
  //   expected_balance_b += new_reward;
  //   expected_balance_main -= new_reward;
  //   await subproject_b.claim(0, {from: individual_B1});
  //   claimed_b += 100000;
  //   indB1_claimed += 100000;
  //   await test_balances(individual_B1, subproject_b, 200000, "Second period claim individual_B1!");
  //   await subproject_b.claim(0, {from: individual_B2});
  //   // claimed_b += 0;
  //   await test_balances(individual_B2, subproject_b, 150000, "Second period claim individual_B2!");
  //   await subproject_b3.claimAndWithdrawFromSponsor();
  //   new_reward = 400000 - expected_balance_b3 + claimed_b3
  //   expected_balance_b3 += new_reward;
  //   expected_balance_b -= new_reward;
  //   await subproject_b3.claim(0, {from: individual_B3A});
  //   claimed_b3 += 100000;
  //   indB3A_claimed += 100000;
  //   await test_balances(individual_B3A, subproject_b3, 200000, "Second period claim individual_B3A!");
  //   await subproject_b3.claim(0, {from: individual_B3B});
  //   claimed_b3 += 100000;
  //   indB3B_claimed += 100000;
  //   await test_balances(individual_B3B, subproject_b3, 350000, "Second period claim individual_B3B!");
  //   await subproject_c.claimAndWithdrawFromSponsor();
  //   // expected_balance_c += 0;
  //   // expected_balance_main -= 0;
  //   await subproject_c.claim(0, {from: individual_C1});
  //   claimed_c += 50000;
  //   indC1_claimed += 50000;
  //   await test_balances(individual_C1, subproject_c, 200000, "Second period claim individual_C1!");
  //   await subproject_c.claim(0, {from: individual_C2});
  //   // claimed_c += 0;
  //   await test_balances(individual_C2, subproject_c, 150000, "Second period claim individual_C2!");
  //   await main_project.claim(0, {from: individual_D});
  //   // claimed_main += 0;
  //   await test_balances(individual_D, main_project, 200000, "Second period claim individual_D!");
  //
  //   // ===== THIRD / LAST PERIOD =====
  //   await increaseTime(PERIOD_LENGTH);
  //   await main_project.claimAndWithdrawFromSponsor();
  //   expected_balance_main += 1500000 - expected_balance_main + claimed_main;
  //   await main_project.claim(0, {from: individual_A});
  //   claimed_main += 100000;
  //   indA_claimed += 100000;
  //   await test_balances(individual_A, main_project, 300000, "Third/Last period claim individual_A!");
  //   await subproject_b.claimAndWithdrawFromSponsor();
  //   new_reward = 500000 - expected_balance_b + claimed_b;
  //   expected_balance_b += new_reward;
  //   expected_balance_main -= new_reward;
  //   await subproject_b.claim(0, {from: individual_B1});
  //   claimed_b += 100000;
  //   indB1_claimed += 100000;
  //   await test_balances(individual_B1, subproject_b, 300000, "Third/Last period claim individual_B1!");
  //   await subproject_b.claim(0, {from: individual_B2});
  //   claimed_b += 0;
  //   await test_balances(individual_B2, subproject_b, 150000, "Third/Last period claim individual_B2!");
  //   await subproject_b3.claimAndWithdrawFromSponsor();
  //   new_reward = 400000 - expected_balance_b3 + claimed_b3;
  //   expected_balance_b3 += new_reward;
  //   expected_balance_b -= new_reward;
  //   await subproject_b3.claim(0, {from: individual_B3A});
  //   claimed_b3 += 100000;
  //   indB3A_claimed += 100000;
  //   await test_balances(individual_B3A, subproject_b3, 300000, "Third/Last period claim individual_B3A!");
  //   await subproject_b3.claim(0, {from: individual_B3B});
  //   claimed_b3 += 100000;
  //   indB3B_claimed += 100000;
  //   await test_balances(individual_B3B, subproject_b3, 450000, "Third/Last period claim individual_B3B!");
  //   await subproject_c.claimAndWithdrawFromSponsor();
  //   // expected_balance_c += 0;
  //   // expected_balance_main -= 0;
  //   await subproject_c.claim(0, {from: individual_C1});
  //   claimed_c += 50000;
  //   indC1_claimed += 50000;
  //   await test_balances(individual_C1, subproject_c, 250000, "Third/Last period claim individual_C1!");
  //   await subproject_c.claim(0, {from: individual_C2});
  //   claimed_c += 0;
  //   await test_balances(individual_C2, subproject_c, 150000, "Third/Last period claim individual_C2!");
  //   await main_project.claim(0, {from: individual_D});
  //   claimed_main += 0;
  //   await test_balances(individual_D, main_project, 200000, "Third/Last period claim individual_D!");
  //
  //   // RETURNING UNUSED TEST
  //   await increaseTime(PERIOD_LENGTH);
  //   await return_to_sponsor_test(subproject_b3, expected_balance_b3, true, expected_balance_b3 - claimed_b3, nextClaimDate + 3*PERIOD_LENGTH, "subproject_b3 returning to sponsor!");
  //   expected_balance_b += expected_balance_b3 - claimed_b3;
  //   await return_to_sponsor_test(subproject_b, expected_balance_b, true, expected_balance_b - claimed_b, nextClaimDate + 3*PERIOD_LENGTH, "subproject_b returning to sponsor!");
  //   expected_balance_main += expected_balance_b - claimed_b;
  //   await return_to_sponsor_test(subproject_c, expected_balance_c, true, 0, nextClaimDate + 3*PERIOD_LENGTH, "subproject_c returning to sponsor!");
  //   await return_to_sponsor_test(main_project, expected_balance_main, true, expected_balance_main - claimed_main, nextClaimDate + 3*PERIOD_LENGTH, "main_project returning to sponsor!");
  //
  //   // WITHDRAW (project balance must be = claimed)
  //   await withdraw_test(individual_A, main_project, claimed_main, indA_claimed, "Withdraw individual A!");
  //   claimed_main -= indA_claimed;
  //   await withdraw_test(individual_B1, subproject_b, claimed_b, indB1_claimed, "Withdraw individual B1!");
  //   claimed_b -= indB1_claimed;
  //   await withdraw_test(individual_B2, subproject_b, claimed_b, indB2_claimed, "Withdraw individual B2!");
  //   await withdraw_test(individual_B3A, subproject_b3, claimed_b3, indB3A_claimed, "Withdraw individual B3A!");
  //   claimed_b3 -= indB3A_claimed;
  //   await withdraw_test(individual_B3B, subproject_b3, claimed_b3, indB3B_claimed, "Withdraw individual B3B!");
  //   await withdraw_test(individual_C1, subproject_c, claimed_c, indC1_claimed, "Withdraw individual C1!");
  //   claimed_c -= indC1_claimed;
  //   await withdraw_test(individual_C2, subproject_c, claimed_c, indC2_claimed, "Withdraw individual C2!");
  //   await withdraw_test(individual_D, main_project, claimed_main, indD_claimed, "Withdraw individual D!");
  //
  //   let final_balance = new BN(await web3.eth.getBalance(main_project.address));
  //   assert.equal(final_balance.toNumber(), 0 , "Incorrect final balance project main!");
  //   final_balance = new BN(await web3.eth.getBalance(subproject_c.address));
  //   assert.equal(final_balance.toNumber(), 0 , "Incorrect final balance project C!");
  //   final_balance = new BN(await web3.eth.getBalance(subproject_b3.address));
  //   assert.equal(final_balance.toNumber(), 0 , "Incorrect final balance project B3!");
  //   final_balance = new BN(await web3.eth.getBalance(subproject_b.address));
  //   assert.equal(final_balance.toNumber(), 0 , "Incorrect final balance project B!");
  });

  it("Claim partial reward", async() => {
    /*
    M (1500/m)
     |-A (100/m) (individual)
     |-B (500/m + 200 one-time) (project)
       |-B1 (100/m) (individual)
       |-B2 (100 one-time + 50 bonus) (individual)
       |-B3 (400/m) (project)
         |- B3_A (100/m) (individual)
         |- B3_B (100/m + 150 bonus) (individual)
     |-C (400 one-time) (project)
       |-C1 (50/m + 50 one-time + 50 bonus) (individual)
       |-C2 (100 one-time + 50 bonus) (individual)
     |-D (200 one-time) (individual)
    */

    increaseTime(PERIOD_LENGTH + 5);
    await main_project.claimAndWithdrawFromSponsor();

    await test_balances2(individual_A, main_project, 0, 1500000, "Before A claim (0)");
    await main_project.claim(50000, {from: individual_A});
    await test_balances2(individual_A, main_project, 50000, 1500000, "After A claim (0)");
    await main_project.claim(50000, {from: individual_A});
    await test_balances2(individual_A, main_project, 50000, 1500000, "After A claim for second time (0)");

    increaseTime(PERIOD_LENGTH);
    await main_project.claimAndWithdrawFromSponsor();

    await test_balances2(individual_A, main_project, 50000, 1550000, "Before A claim (1)");
    await main_project.claim(100000, {from: individual_A});
    await test_balances2(individual_A, main_project, 150000, 1550000, "After A claim (1)");
    await main_project.claim(50000, {from: individual_A});
    await test_balances2(individual_A, main_project, 150000, 1550000, "After A claim for second time (1)");


    increaseTime(PERIOD_LENGTH);
    await main_project.claimAndWithdrawFromSponsor();

    await test_balances2(individual_A, main_project, 150000, 1650000, "Before A claim (2)");
    await main_project.claim(30000, {from: individual_A});
    await test_balances2(individual_A, main_project, 180000, 1650000, "After A claim (2)");
    await main_project.claim(70000, {from: individual_A});
    await test_balances2(individual_A, main_project, 180000, 1650000, "After A claim for second time (2)");

    increaseTime(PERIOD_LENGTH);
    await return_to_sponsor_test(main_project, 1650000, true, 1650000 - 180000, nextClaimDate + 3*PERIOD_LENGTH, "Main return unused");
    await withdraw_test(individual_A, main_project, 180000, 180000, "Individual A withdraws");
    await test_balances2(individual_A, main_project, 0, 0, "After withdarw");
  });
});
