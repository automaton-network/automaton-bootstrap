
```solidity
/**
  Invited -> Invited to join the project, hasn't joined yet
  Active ->
  Inactive -> Left the project, fired or hasn't joined, has no voting rights, could not create proposals
*/
enum ContributorState {Invalid, Invited, Active, Inactive}

struct ContributorData {  // 6-8 slots
  ContributorState state;
  bool isContract;
  uint248 contributorsListIdx;
  uint128 weight;
  uint128 pollsIds;  // poll id for a contributor is <address><++pollIds>

  uint256 nextClaimDate;
  uint128 periodsLeft;
  uint128 rewardPerPeriod;
  uint128 oneTimeReward;
  uint128 bonus;

  // doulbe linked list for active?? contributors
  address previous;
  address next;
}

bool isActive;
address[] contributorsList;
mapping (address => ContributorData) public contributors;

// Budget
Sponsor/address sponsor;
uint128 public periodsLeft;
uint128 public rewardPerPeriod;
uint256 public nextClaimDate;  // Beginning of the next period

// TODO(kari): Proper calculation of current usage. Approved bonuses and one-time rewards shouldn't exceed
// what's really available

uint256 public claimed;  // claimed but not withdrawn, to be used when claiming and returning money to sponsor
uint256 public distributedBonuses;  // given bonuses to contributors that are not yet claimed
uint256 public undistributedBonus;  // to be distributed through special voting

mapping (address => uint256) public balances;

function checkForMissedPeriods() public;

function withdrawFromSponsor() public external
    returns (uint128 _rewardPerPeriod, uint128 _oneTimeReward, uint128 _bonus) {

function claim(uint256 _value) external returns (uint128 _rewardPerPeriod, uint128 _oneTimeReward, uint128 _bonus);

function returnUnspentToSponsor() public

function withdraw(uint256 _value) external

function receive() external payable;
```

### Periods for claiming ###

1. Monthly (per period) reward -> [the end of the current period; the end of the current period + 1 period)
2. One-time rewards -> [reward approval; the end of the current period)
3. Bonuses -> [reward approval; the end of the world)

### Project rewards ###

1. Monthly reward ->
periodsLeft and budgetPerPeriod should be set. This type of reward could be used for members' monthly
rewards, one-time rewards and bonuses. Unused rewards of this type will be returned to the sponsor.

2. One-time reward ->
periodsLeft should be set, one-time reward will be paid to the contract but no variable will show that (only
contract's value). This type of reward could be used for members' monthly rewards, one-time rewards and
bonuses. Unused rewards of this type will be returned to the sponsor.
**If this is additional reward to monthly rewards, will be returned at the end of the period, meaning it MUST be
spent during the same period as claimed (which could be quite short period). If no monthly rewards are received,
these rewards will be returned to sponsor after the project ends (all periods have passed + 1 bonus for
claiming).**

* To give monthly rewards, project MUST have periodsLeft set even if project will only receive one-time
reward(s). Hired members' periodsLeft must be <= project's periodsLeft.

* If project does not have periodsLeft set, could receive only bonuses (undistributedBonus).

3. Bonus ->
undistributedBonus should be set. Could only be distributed through special voting for bonuses
distribution (which could include only subset of members). This is used for final bonus.
Unused bonuses are NOT returned to the sponsor and could stay in the contract forever.

### Project types based on what variables has set and what rewards it receives ###

1. Basic project -> receives rewards monthly, based on some predefined 'salary' which could use for monthly
rewards, one-time rewards and bonuses. Could receive one-time rewards but they must be used during the same period as
claimed or will be returned to the sponsor.
At the beginning of every period project claims its monthly reward minus what hasn't used from previous month, which could include unused one-time reward (project claims _rewardPerPeriod + claimed + distributedBonuses + undistributedBonus - currentValue_).

Unused rewards are returned to the sponsor at the end of the project.
Could receive bonuses and distribute them among its members/contributors.
PeriodsLeft and monthlyReward should be set.

2. Project reserve? -> receives rewards (one-time) which could use for monthly rewards,
rewards and bonuses, but do not rely on monthly rewards and do not 'return' unused rewards until the end of the
project. Project that is used as a reserve.

Unused rewards are returned to the sponsor at the end of the project.
Could receive bonuses and distribute them through voting among its members/contributors.
PeriodsLeft should be set, monthlyReward sould be 0.

### IDEA: Donations ###

* If project receives rewards from unknown source (known sources are the sponsor and members, ** members could
  return unused rewards), it could be set as bonus and distributed among members.

### Contributor data explained ###

ContributorData struct explained:

state - ...

nextClaimDate - ...

periodsLeft - ...

**rewardPerPeriod** - full period reward, for hourly rewards member claims less than this value based on worked
hours (e.g if this is 160 hours reward, and member worked 120 hours, they will claim 3/4 reward). This reward
is valid only if periodsLeft is set.
* If the contributor is subproject and this reward is not used, will be returned to the sponsor.

**oneTimeReward** - reward in addition to monthly(period) rewards. This reward is valid only for the CURRENT
period of the project, if not claimed during the period, will be lost. Could be changed by voting.
* If the contributor is subproject and this reward is not used, will be returned to the sponsor.

**bonus** - current bonus that is approved for this member, could not be decreased by voting, when creating proposal
for a new bonus, the new bonus value will be ADDED (NOT REPLACED) to this, if proposal is approved.
* If the contributor is subproject and this reward is not used, will NOT be returned to the sponsor.
* If it is not claimed, will not be lost
* Is automatically claimed when monthly reward (or just when claim() is called) is claimed

### Returning unused rewards to sponsor ###

At the end of the project (after all periods have passed + the additional period for claiming) all unused
rewards will be returned to the sponsor. This include monthly and one-time rewards that are not fully used. This
excludes claimed but not withdrawn rewards (variable claimed), bonuses that are given to the contributors but are
not yet claimed (variable distributedBonuses), bonuses that are given to the project, but not yet distributed
and need special type of voting (variable undistributedBonus).

* After claiming from sponsor the value that must be in the contract is the sum of
  * budgetPerPeriod
  * claimed
  * distributedBonuses
  * undistributedBonus


* After returning unused rewards (after all periods have passed and the project has ended) the value that must
remain in the contract is the sum of
  * claimed
  * distributedBonuses
  * undistributedBonus

**If sponsor has changed before the returning of the rewards, rewards will be returned to the NEW sponsor (since
the old one has given his rights as a sponsor to the new one)**
