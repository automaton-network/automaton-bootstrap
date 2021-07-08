```solidity
contract Project is Sponsor {
  /**
    Invited -> Invited to join the project, hasn't joined yet
    Active ->
    Inactive -> Left the project, fired or hasn't joined, has no voting rights,
      could not create proposals, but could receive bonuses
  */
  enum ContributorState {Uninitialized, Invited, Active, Inactive}

  struct ContributorData {  // 6-8 slots
    ContributorState state;
    bool isContract;
    uint248 contributorsListIdx;
    uint128 weight;
    uint128 pollsIds;  // poll id for a contributor is <address\><++pollIds\>

    uint256 nextClaimDate;
    uint128 periodsLeft;
    uint128 rewardPerPeriod;
    uint128 oneTimeReward;
    uint128 bonus;

    // double linked list for active members?
    address previous;
    address next;
  }

  enum PollState {Uninitialized, Unstarted, Active, Accepted, Rejected, Finalized, Expired}

  enum PollType {Uninitialized, MemberUpdate, ParameterChange, BonusDitribution}

  struct MemberUpdateData {  // 4 slots
    address addr;
    bool[5] idxs;  // Which of next parameters to be changed because 0 is valid value
    bool toRemove;

    uint128 weight;
    uint128 periodsLeft;
    uint128 rewardPerPeriod;
    uint128 oneTimeReward;
    uint128 bonus;
  }

  struct ParameterChangeData {  // 1 slot
    uint8 index;
    uint248 value;
  }

  struct BonusDitributionData {
    address[] contributors;
    uint256 sum;
    mapping(address => uint256) values;
  }

  // id == pollId
  mapping(uint256 => MemberUpdateData) public pollsMemberUpdateData;
  mapping(uint256 => ParameterChangeData) public pollsParameterChangeData;
  mapping(uint256 => BonusDitributionData) public pollsBonusDitributionData;

  struct Poll {
    PollState state;
    uint256 pollsIdsListIdx;
    PollType type;
    uint256 endDate;
    uint128 yesVotesWeight;
    uint128 noVotesWeight;
    uint256[] voteWords;  // If this is a map, we should also store the length to delete the polls properly

    // double linked list for active polls?
    uint256 previous;
    uint256 next;
  }

  address[] public contributorsList;
  mapping (address => ContributorData) public contributors;

  // Voting
  uint64 public instantApprovalPct;
  uint64 public approvalPtc;
  uint64 public totalVotingWeight;
  uint32 public votingPeriod;
  uint32 public pollValidity = 2 weeks;
  uint256 public pollsIds;  // creating new poll for bonus distribution or parameter change -> pollsIds++
  uint256[] public pollsIdsList;
  mapping (uint256 => Poll) public polls;

  Sponsor/address sponsor;

  uint256 public claimed;  // claimed but not withdrawn, to be used when claiming and returning money to sponsor
  uint256 public distributedBonuses;  // given bonuses to contributors that are not yet claimed
  uint256 public undistributedBonus;  // to be distributed through special voting
  uint256 public bonusDitributionInProgress;  // id of a bonus distribution poll that is in progress, plays the role of a mutex

  // Creating polls

  function createMemberUpdatePoll(
      address addr,
      bool[5] memory idxs,  // Which of next parameters to be changed because 0 is valid value
      bool toRemove,  // propose member for removal / firing

      uint128 weight,
      uint128 periodsLeft,
      uint128 rewardPerPeriod,
      uint128 oneTimeReward,
      uint128 bonus) public;

  function createParameterChangePoll(uint256 index, uint256 value) public;  // Version 2

  function createBonusDitributionPoll(address[] memory _contributors, uint256[] memory _values, bool _isReady) public;

  // In case we couldn't set all the contributors in one transaction
  function addBonusDitributionPollData(
      uint256 _id, address[] memory _contributors, uint256[] memory _values, bool _isReady) public;

  // Voting

  function calcVoteDifference(uint256 _id) view public returns (int256);

  function castVote(uint256 _id, uint8 _choice) public;

  function getVote(uint256 _id, address _addr) public view returns (uint256);

  // Used when contributor's voting weight has changed
  function updateVote(uint256 _id, address _addr, uint256 _oldWeight, uint256 _newWeight) private;

  // Poll processing

  // Call after poll has been processed to free up space
  function deletePoll(uint256 _id) public;

  function updatePoll(uint256 _id) public;

  function processMemberUpdatePoll(uint256 _id) public;
  function processParameterChangePoll(uint256 _id) public {}  // Version 2
  function processBonusDitributionPoll(uint256 _id) public;

  function join(
      uint256 pollId,
      uint128 weight,
      uint128 periodsLeft,
      uint128 rewardPerPeriod,
      uint128 oneTimeReward,
      uint128 bonus) public;
```

* We have 3 types of polls
  - for member's parameters change (including proposing new member) -- type 1
  - for bonus distribution -- type 2
  - for contract's parameter change -- type 3

* pollId = *address|index* for type 1 polls or *id* for type 2 and 3 polls

* pollId is also used for finding the data in one of pollsMemberUpdateData, pollsParameterChangeData or
pollsBonusDitributionData depending on the poll's type (PollType)

*  **Poll has some validity period and can be processed before it ends. After that period the poll expires and cannot take effect.**

##### Poll struct explained #####

1. PollState state ->
  * Unstarted -> Used only for bonus distribution polls where we may need to add more members after
  creating the poll. If we haven't added all members in one transaction (ran out of gas or else), we need to
  call a separate function (addBonusDitributionPollData()) to add them. We can call this function as many times as
  we need until we set isReady parameter = true.
  * Active -> Voting has started.
  * Accepted -> Poll proposal was accepted but hasn't yet come into effect. **Should be processed (process<pollType\>Poll() to be called) before the validity period passes, otherwise won't take effect.**
  * Rejected -> Poll proposal was NOT accepted.
  * Finalized -> Poll has been accepted and processed. Poll can now be deleted.
  * Expired -> Validity period has passed. A poll could come to this state from Active, Accepted, Rejected or Finalized. Poll can now be deleted.


2. uint256 pollsIdsListIdx -> index of this poll in pollsIdsList

3. PollType type -> shows the poll's type, one of MemberUpdate, ParameterChange or BonusDitribution

4. uint256 endDate -> when the poll stops being active and voting ends; *creating poll date + votingPeriod*

5. uint128 yesVotesWeight -> sum of voting weights of members voted "yes"

6. uint128 noVotesWeight -> sum of voting weights of members voted "no"

7. uint256[] voteWords -> contains (contributorsList.length / 127) voting words

##### Variables and functions explained #####

* uint256[] pollsIdsList -> stores polls ids
  - when a poll is deleted, it is replaced by the last poll in the list, pollsIdsListIdx of the last poll is updated

* uint64 instantApprovalPct

* uint64 approvalPtc

* uint64 totalVotingWeight -> the sum of the voting weights of all active members

* uint64 votingPeriod -> length of the voting period of a poll, when creating a poll,
    its end date (endDate) = now + votingPeriod

* uint256 pollsIds -> id of the last created poll of type 2 and 3
  - when creating new poll for parameter change or bonus distribution, its id is ++pollsIds

* uint256[] pollsIdsList -> ids of all created polls that are not deleted yet

* mapping (uint256 => Poll) polls

* uint256 public bonusDitributionInProgress - id of a bonus distribution poll that is in progress, plays the role of a mutex so other bonus distribution polls cannot be processed before this one finishes

---

* function createMemberUpdatePoll(
    - address addr
    - bool[5] memory idxs  - which of next parameters to be changed because **0 is valid value**
    - bool toRemove  - propose member for removal / firing

    - uint128 weight
    - uint128 periodsLeft
    - uint128 rewardPerPeriod
    - uint128 oneTimeReward
    - uint128 bonus

    Create a proposal to hire or fire a member or to change a member's parameter(s)

* function createParameterChangePoll(uint256 index, uint256 value)

  **Version 2**
  Create a proposal to change one of the project's parameters (periods, rewards)

* function createBonusDitributionPoll(address[] memory contributors, uint256[] memory values, bool isReady)

  Create a proposal on how to distribute the received bonuses among the contributors

* function addBonusDitributionPollData(uint256 id, address[] memory contributors, uint256[] memory values, bool isReady)

  Add more members to a bonus distribution poll before the voting starts

* function deletePoll(uint256 id)

  Delete a poll when it's no longer needed.

* function updatePoll(uint256 id)

* function process<PollType\>Poll(uint256 id)

  Accepted polls take effect.

  - function processMemberUpdatePoll(uint256 id)
  - function processParameterChangePoll(uint256 id)
  - function processBonusDitributionPoll(uint256 id)


* function join(
    uint256 pollId
    uint128 weight
    uint128 periodsLeft
    uint128 rewardPerPeriod
    uint128 oneTimeReward
    uint128 bonus

    Use to join the project. Joining the project requires the member to select a poll/proposal whose terms
    to accept - *pollId*.


### THINGS TO CONSIDER ###

1. Subset of members who can vote could change during voting:
  - one of the members could lose their right to vote during the voting process, should the vote be removed?
  - this also would affect totalVotingWeight / all the proposals
    - is it possible to loop through the active polls to update
    the vote
    - or maybe verify votes at the end of the voting - which means looping through all the contributors that have
    voted and check if they still have the right to vote -- this should be avoided unless the number of contributors
     is guaranteed to be small


2. We may need to filter all polls for a specific member or type - e.g. if somebody has been fired,
  all currently running polls for this member should be removed or if we are voting for some bonus distribution
  and there are many different distributions

  ** All polls for a specific member have id starting with the member's address, but they could be too many
  to loop through
