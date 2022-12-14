pragma solidity ^0.6.2;

interface Sponsor {
  function claimReward(uint256 _value) external
      returns (uint128 _monthlyReward, uint128 _bonus);
  function withdrawReward(uint256 _value) external;
}

/*
TODO(kari):
1. Think of situations where
   - project has no active members (there will be no one to vote)
   - project has only subprojects as members (there will be no one to vote)
   - there is no sponsor
*/

contract Project is Sponsor {
  uint256 constant PERIOD_LENGTH = 1 weeks;
  uint256 constant UINT256_MAX = ~uint256(0);

  /**
    Invited -> Invited to join the project, hasn't joined yet
    Active ->
    Inactive -> Left the project, fired or hasn't joined, has no voting rights, could not create proposals, but could receive bonuses
  */
  enum ContributorState {Uninitialized, Invited, Active, Inactive}

  struct ContributorData {  // 6-8 slots
    ContributorState state;
    bool isContract;
    uint248 contributorsListIdx;
    uint128 weight;
    uint128 pollsIds;  // poll id for a contributor is <address><++pollIds>

    uint256 nextClaimDate;
    uint128 periodsLeft;
    uint128 rewardPerPeriod;
    uint128 bonus;

    address previousActive;
    address nextActive;
  }

  /*
    * Unstarted -> Used only for type 3 polls (bonus distribution) where we may need to add more members after
    creating the poll. If we haven't added all members at one transaction (ran out of gas or else), we need to
    call separate function (addBonusDitributionPollData()) to add them. We can call this function as many times as
    we need until we set isReady parameter = true.
    * Active -> Voting has started.
    * Accepted -> Poll proposal was accepted but hasn't yet come into effect. **Should be processed (process<pollType>Poll() to be called) before the validity period pass, otherwise won't take effect.**
    * Rejected -> Poll proposal was NOT accepted.
    * Finalized -> Poll has been accepted and processed.
    * Expired -> Validity period has passed and could be deleted to free up space. A poll could come to this state from Active, Accepted, Rejected or Finalized.
  */
  enum PollState {Uninitialized, Unstarted, Active, Accepted, Rejected, Finalized, Expired}

  enum PollType {Uninitialized, MemberUpdate, ParameterChange, BonusDitribution}

  struct MemberUpdateData {  // 4 slots
    address addr;
    bool[4] idxs;  // Which of next parameters to be changed because 0 is valid value
    bool toRemove;

    uint128 weight;
    uint128 periodsLeft;
    uint128 rewardPerPeriod;
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
    // address creator; ??
    PollState state;
    uint256 pollsIdsListIdx;
    PollType pType;
    uint256 endDate;
    uint128 yesVotesWeight;
    uint128 noVotesWeight;
    uint256[] voteWords;  // If this is a map, we should also store the length to delete the poll properly

    uint256 previousActive;
    uint256 nextActive;
  }

  bool isActive;
  address[] contributorsList;
  mapping (address => ContributorData) public contributors;
  address contributorsDLLHead = 0x0000000000000000000000000000000000000000;
  address contributorsDLLTail = 0x0000000000000000000000000000000000000000;
  uint128 activeContributorsCount = 0;
  uint128 activePollsCount = 0;
  uint256 pollsDLLHead = 0;
  uint256 pollsDLLTail = 0;

  // Budget
  Sponsor public sponsor;
  uint128 public periodsLeft;
  uint128 public rewardPerPeriod;
  uint256 public nextClaimDate;  // Beggining of the next period

  // Voting
  uint256 totalVotingWeight;
  uint64 instantApprovalPct;
  uint64 approvalPtc;
  uint64 votingPeriod;
  uint64 pollValidity = 2 weeks;
  uint256 pollsIds;  // creating new poll for bonus distribution or parameter change -> pollsIds++
  uint256[] pollsIdsList;
  mapping (uint256 => Poll) public polls;

  uint256 public claimed;  // claimed but not withdrawn, to be used when claiming and returning money to sponsor
  uint256 public undistributedCurrentPeriod;
  uint256 public nextPeriodUsage;
  uint256 public distributedBonuses;  // given to contributors bonuses that are not yet claimed
  uint256 public undistributedBonus;  // to be distributed through special voting
  uint256 public bonusDitributionInProgress;  // id of a bonus distribution poll that is in progress, plays the role of a mutex

  modifier validPollID(uint256 _id) {
    require(polls[_id].state != PollState.Uninitialized);
    _;
  }

  function isContract(address _addr) public returns (bool) {
    // TODO(kari)
    return false;
  }

  function checkForMissedPeriods() public {
    uint256 _nextClaimDate = nextClaimDate;
    uint128 _periodsLeft = periodsLeft;
    if (_nextClaimDate > 0 && _nextClaimDate + PERIOD_LENGTH < now) {
      uint256 missedPeriods = (now - _nextClaimDate) / PERIOD_LENGTH;
      if (missedPeriods >= _periodsLeft) {
        nextClaimDate = 0;
        periodsLeft = 0;
        rewardPerPeriod = 0;
      } else {
        nextClaimDate += missedPeriods * PERIOD_LENGTH;
        periodsLeft -= uint128(missedPeriods);
      }
    }
  }

  function checkForMissedPeriodsContributor(address _addr) public {
    ContributorData memory _c_mem = contributors[_addr];
    ContributorData storage _c_storage = contributors[_addr];
    require(_c_mem.state == ContributorState.Active);
    if (_c_mem.periodsLeft == 0) {
      return;
    }
    assert(_c_mem.nextClaimDate > 0);
    if (_c_mem.nextClaimDate + PERIOD_LENGTH < now) {
      uint256 missedPeriods = (now - _c_mem.nextClaimDate) / PERIOD_LENGTH;
      if (missedPeriods >= _c_mem.periodsLeft) {
        _c_storage.nextClaimDate = 0;
        _c_storage.periodsLeft = 0;
        _c_storage.rewardPerPeriod = 0;
      } else {
        _c_storage.nextClaimDate += missedPeriods * PERIOD_LENGTH;
        _c_storage.periodsLeft -= uint128(missedPeriods);
      }
    }
  }

  // Creating polls

  function createMemberUpdatePoll(
      address _addr,
      bool[4] memory _idxs,  // Which of next parameters to be changed because 0 is valid value
      bool _toRemove,

      uint128 _weight,
      uint128 _periodsLeft,
      uint128 _rewardPerPeriod,
      uint128 _bonus) public {
    require(contributors[msg.sender].state == ContributorState.Active);  // or msg.sender == sponsor
    require(_addr != 0x0000000000000000000000000000000000000000);
    ContributorData storage _c_storage = contributors[_addr];
    _c_storage.pollsIds++;

    ContributorData memory _c_mem = contributors[_addr];
    // require(_contributor.pollsIds < , "Cannot create new poll for this member!");
    uint256 _id = (uint256(_addr) << 12) & (_c_mem.pollsIds);
    if (_c_mem.state == ContributorState.Uninitialized) {
      bool _isContract = isContract(_addr);
      _c_storage.isContract = _isContract;
      _c_mem.isContract = _isContract;
    }

    pollsIdsList.push(_id);
    Poll storage _poll = polls[_id];
    assert(_poll.state == PollState.Uninitialized);
    MemberUpdateData storage _data = pollsMemberUpdateData[_id];
    assert(_data.addr == 0x0000000000000000000000000000000000000000);
    _poll.pollsIdsListIdx = pollsIdsList.length - 1;
    _poll.state = PollState.Active;
    _poll.pType = PollType.MemberUpdate;
    _poll.endDate = now + votingPeriod;

    _data.addr = _addr;
    _data.toRemove = _toRemove;
    _data.idxs = _idxs;
    if (_idxs[0]) {
      require(_c_mem.isContract == false, "Could not set voting weight to a contract!");
      _data.weight = _weight;
    }
    _data.periodsLeft = _idxs[1] ? _periodsLeft : 0;
    _data.rewardPerPeriod = _idxs[2] ? _rewardPerPeriod : 0;
    _data.bonus = _idxs[3] ? _bonus : 0;
    addPollToDLL(_id);
  }

  function createInitialMemberPoll(
      address _addr,
      uint128 _weight,
      uint128 _periodsLeft,
      uint128 _rewardPerPeriod,
      uint128 _bonus) private {
    ContributorData storage _c_storage = contributors[_addr];
    bool _isContract = isContract(_addr);
    require(_isContract == false, "Contracts cannot be initial members!");
    _c_storage.pollsIds++;

    ContributorData memory _c_mem = contributors[_addr];
    uint256 _id = (uint256(_addr) << 12) & (_c_mem.pollsIds);

    pollsIdsList.push(_id);
    Poll storage _poll = polls[_id];
    MemberUpdateData storage _data = pollsMemberUpdateData[_id];
    _poll.pollsIdsListIdx = pollsIdsList.length - 1;
    _poll.state = PollState.Accepted;
    _poll.pType = PollType.MemberUpdate;
    _poll.endDate = now;

    _data.addr = _addr;
    _data.idxs[0] = _data.idxs[1] = _data.idxs[2] = _data.idxs[3] = true;
    _data.weight = _weight;
    _data.periodsLeft = _periodsLeft;
    _data.rewardPerPeriod = _rewardPerPeriod;
    _data.bonus = _bonus;
  }

  function createParameterChangePoll(uint256 index, uint256 value) public {
    // Version 2
  }

  function createBonusDitributionPoll(address[] memory _contributors, uint256[] memory _values, bool _isReady) public {
    require(_contributors.length == _values.length);
    require(contributors[msg.sender].state == ContributorState.Active);  // or msg.sender == sponsor?
    uint256 _id = ++pollsIds;

    pollsIdsList.push(_id);
    Poll storage _poll = polls[_id];
    assert(_poll.state == PollState.Uninitialized);
    BonusDitributionData storage _data = pollsBonusDitributionData[_id];
    assert(_data.contributors.length == 0);
    _poll.pollsIdsListIdx = pollsIdsList.length - 1;
    _poll.pType = PollType.BonusDitribution;
    _data.contributors = _contributors;
    uint256 _sum = 0;

    for (uint256 i = 0; i < _contributors.length; ++i) {
      if (_data.values[_contributors[i]] > 0) {
        _sum -= _data.values[_contributors[i]];
      }
      _data.values[_contributors[i]] = _values[i];
      _sum += _values[i];
    }
    _data.sum = _sum;

    if (_isReady) {
      _poll.state = PollState.Active;
      _poll.endDate = now + votingPeriod;
      addPollToDLL(_id);
    } else {
      _poll.state = PollState.Unstarted;
    }
  }

  // In case we couldn't set all the contributors in one transaction or we want to make a correction
  function addBonusDitributionPollData(
      uint256 _id, address[] memory _contributors, uint256[] memory _values, bool _isReady) public {
    require(contributors[msg.sender].state == ContributorState.Active);  // or msg.sender == sponsor
    require(polls[_id].state == PollState.Unstarted, "Poll must be Unstarted!");
    require(polls[_id].pType == PollType.BonusDitribution, "Wrong poll type!");
    require(_contributors.length == _values.length, "Contributors and values arrays must have equal length!");
    BonusDitributionData storage _data = pollsBonusDitributionData[_id];
    uint256 _sum = _data.sum;

    for (uint256 i = 0; i < _contributors.length; ++i) {
      _data.contributors.push(_contributors[i]);  // There could be duplicates
      if (_data.values[_contributors[i]] > 0) {
        _sum -= _data.values[_contributors[i]];
      }
      _data.values[_contributors[i]] = _values[i];
      _sum += _values[i];
    }
    _data.sum = _sum;

    if (_isReady) {
      polls[_id].state = PollState.Active;
      polls[_id].endDate = now + votingPeriod;
      addPollToDLL(_id);
    }
  }

  function addPollToDLL(uint256 _id) private {
    Poll storage _poll = polls[_id];
    if (_poll.state != PollState.Active) {
      return;
    }

    if (pollsDLLHead == 0) {
      pollsDLLHead = pollsDLLTail = _id;
    } else {
      polls[pollsDLLHead].previousActive = _id;
      _poll.nextActive = pollsDLLHead;
      pollsDLLHead = _id;
    }
    activePollsCount++;
  }

  function removePollFromDLL(uint256 _id) private {
    Poll storage _s_poll = polls[_id];
    Poll memory _m_poll = polls[_id];
    if (_m_poll.state == PollState.Active) {
      return;
    }

    // if the poll is not part of the dll
    if (_m_poll.previousActive == 0 && _m_poll.nextActive == 0 &&
        (activePollsCount > 1 || (activePollsCount == 1 && pollsDLLHead != _id))) {
      return;
    }

    if (_m_poll.previousActive != 0) {
      polls[_m_poll.previousActive].nextActive = _m_poll.nextActive;
      _s_poll.previousActive = 0;
    } else {
      pollsDLLHead = _m_poll.nextActive;
    }

    if (_m_poll.nextActive != 0) {
      polls[_m_poll.nextActive].previousActive = _m_poll.previousActive;
      _s_poll.nextActive = 0;
    } else {
      pollsDLLTail = _m_poll.previousActive;
    }

    activePollsCount--;
  }

  function addContributorToDLL(address _addr) private {
    ContributorData storage _contributor = contributors[_addr];
    if (_contributor.state != ContributorState.Active) {
      return;
    }

    if (contributorsDLLHead == 0x0000000000000000000000000000000000000000) {
      contributorsDLLHead = contributorsDLLTail = _addr;
    } else {
      contributors[contributorsDLLHead].previousActive = _addr;
      _contributor.nextActive = contributorsDLLHead;
      contributorsDLLHead = _addr;
    }
    activeContributorsCount++;
  }

  function removeContributorFromDLL(address _addr) private {
    ContributorData storage _s_contributor = contributors[_addr];
    ContributorData memory _m_contributor = contributors[_addr];
    if (_m_contributor.state == ContributorState.Active) {
      return;
    }

    // if contributor is not part of the dll
    if (_m_contributor.previousActive == 0x0000000000000000000000000000000000000000 && _m_contributor.nextActive == 0x0000000000000000000000000000000000000000 &&
        (activeContributorsCount > 1 || (activeContributorsCount == 1 && contributorsDLLHead != _addr))) {
      return;
    }

    if (_m_contributor.previousActive != 0x0000000000000000000000000000000000000000) {
      contributors[_m_contributor.previousActive].nextActive = _m_contributor.nextActive;
      _s_contributor.previousActive = 0x0000000000000000000000000000000000000000;
    } else {
      contributorsDLLHead = _m_contributor.nextActive;
    }

    if (_m_contributor.nextActive != 0x0000000000000000000000000000000000000000) {
      contributors[_m_contributor.nextActive].previousActive = _m_contributor.previousActive;
      _s_contributor.nextActive = 0x0000000000000000000000000000000000000000;
    } else {
      contributorsDLLTail = _m_contributor.previousActive;
    }

    activeContributorsCount--;
  }

  // function getRewardAvailability() private view returns (uint256) {
  //   // checkForMissedPeriods()
  //   uint256 _nextPeriodUsage = nextPeriodUsage;
  //   uint256 _rewardPerPeriod = rewardPerPeriod;
  //   uint256 _nextClaimDate = nextClaimDate;
  //   uint256 _periodsLeft = _nextClaimDate > now ? periodsLeft : periodsLeft - 1;
  //
  //   if (_periodsLeft == 0) {
  //     return 0;
  //   }
  //   // assert(_nextPeriodUsage <= _rewardPerPeriod);
  //   return _nextPeriodUsage < _rewardPerPeriod ? _rewardPerPeriod - _nextPeriodUsage : 0;
  // }

  function getBonusAvailability() public view returns (uint256) {
    uint256 inUse = distributedBonuses + undistributedBonus + claimed + undistributedCurrentPeriod;
    // This could happen if the project's rewardPerPeriod has been decreased
    // assert(this.value >= inUse);
    uint256 value = address(this).balance;
    return value >= inUse ? value - inUse : 0;
  }

  // Voting

  function calcVoteDifference(uint256 _id) public view validPollID(_id) returns (int256) {
    Poll memory b = polls[_id];
    int256 yes = int256(b.yesVotesWeight);
    int256 no = int256(b.noVotesWeight);
    return (yes - no) * 100 / int256(totalVotingWeight);
  }

  function castVote(uint256 _id, uint8 _choice) public validPollID(_id) {
    updatePoll(_id);
    require(_choice <= 2, "Invalid choice");
    Poll memory _poll = polls[_id];
    require(_poll.state == PollState.Active, "Poll is not active!");
    ContributorData memory _contributor = contributors[msg.sender];
    require(_contributor.state == ContributorState.Active, "Contributor is not active!");

    // Calculate masks.
    uint256 index = _contributor.contributorsListIdx / 127;
    if (index < _poll.voteWords.length) {
      // TODO(kari): Add the necessary amount of words to the array if it's more than 1
      polls[_id].voteWords.push();  // ??
      _poll = polls[_id];
    }

    uint256 offset = (_contributor.contributorsListIdx % 127) * 2;
    uint256 mask = 3 << offset;

    // Reduce the vote count.
    uint256 vote = _poll.voteWords[index];
    uint256 oldChoice = (vote & mask) >> offset;
    if (oldChoice == 1) {
      polls[_id].yesVotesWeight -= _contributor.weight;
    } else if (oldChoice == 2) {
      polls[_id].noVotesWeight -= _contributor.weight;
    } else {
      // assert
    }

    // Modify vote selection.
    vote &= (mask ^ UINT256_MAX);        // get rid of current choice using a mask.
    vote |= uint256(_choice) << offset;  // replace current choice using a mask.
    polls[_id].voteWords[index] = vote;      // actually update the storage slot.
    // update the total vote count based on the choice.
    if (_choice == 1) {
      polls[_id].yesVotesWeight += _contributor.weight;
    } else if (_choice == 2) {
      polls[_id].noVotesWeight += _contributor.weight;
    }
  }

  function getVote(uint256 _id, address _addr) public view validPollID( _id) returns (uint256) {
    ContributorData memory _contributor = contributors[_addr];
    require(_contributor.contributorsListIdx > 0);
    // Calculate masks.
    uint256 index = _contributor.contributorsListIdx / 127;
    uint256 offset = (_contributor.contributorsListIdx % 127) * 2;
    uint256 mask = 3 << offset;

    // Get vote
    return ( polls[_id].voteWords[index] & mask) >> offset;
  }

  // TODO(kari): Do this in chunks
  function updateVotes(address _addr, uint128 _oldWeight, uint128 _newWeight) private {
    if (_oldWeight == 0) {
      return;
    }
    uint256 _pollId = pollsDLLHead;
    uint256 _contrIdx = contributors[_addr].contributorsListIdx;
    uint256 index = _contrIdx / 127;
    uint256 offset = (_contrIdx % 127) * 2;
    uint256 mask = 3 << offset;

    Poll memory _poll;
    while (_pollId > 0) {
      _poll = polls[_pollId];
      uint256 vote = _poll.voteWords[index];
      uint256 _choice = (vote & mask) >> offset;
      if (_choice == 1) {
        polls[_pollId].yesVotesWeight -= _oldWeight;
        polls[_pollId].yesVotesWeight += _newWeight;
      } else if (_choice == 2) {
        polls[_pollId].noVotesWeight -= _oldWeight;
        polls[_pollId].noVotesWeight += _newWeight;
      }
      _pollId = _poll.nextActive;
    }
  }

  // Poll processing

  // Called after poll results are processed
  function deletePoll(uint256 _id, uint256 _loopSize) public {
    Poll storage _poll = polls[_id];
    require(_poll.state == PollState.Expired, "Invalid poll state!");

    // Delete poll data specific for this poll type
    if (_poll.pType == PollType.MemberUpdate) {
      delete pollsMemberUpdateData[_id];
    } else if (_poll.pType == PollType.ParameterChange) {
      delete pollsParameterChangeData[_id];
    } else if (_poll.pType == PollType.BonusDitribution) {
      // Free memory used in mapping
      address[] memory _contributors = pollsBonusDitributionData[_id].contributors;
      if (_contributors.length <= _loopSize) {
        for (uint256 i = 0; i < _contributors.length; ++i) {
          pollsBonusDitributionData[_id].values[_contributors[i]] = 0;
        }
        delete pollsBonusDitributionData[_id];
      } else {
        for (uint256 i = _contributors.length - 1; i >= _contributors.length - _loopSize; --i) {
          pollsBonusDitributionData[_id].values[_contributors[i]] = 0;
          pollsBonusDitributionData[_id].contributors.pop();
        }
        return;
      }
    }

    // Remove poll from pollsIdsList and move the last element
    if (pollsIdsList.length > 1) {
      uint256 _idx = _poll.pollsIdsListIdx;
      uint256 _lastId = pollsIdsList.length - 1;
      polls[_lastId].pollsIdsListIdx = _idx;  // change its index in the list
      pollsIdsList[_idx] = _lastId;  // add it to its new place in the list -> will that copy it or make link??
    }
    pollsIdsList.pop();  // remove it from the end

    delete polls[_id];
    assert(polls[_id].state == PollState.Uninitialized);
  }

  function updatePoll(uint256 _id) public validPollID(_id) {
    Poll memory _poll = polls[_id];
    if (_poll.state == PollState.Expired || _poll.state == PollState.Unstarted) {
      return;
    }

    // This poll has been accepted and is in progress, cannot expire while being processed
    if (bonusDitributionInProgress == _id) {
      return;
    }

    // Poll has expired
    if (_poll.endDate + pollValidity < now) {
      polls[_id].state = PollState.Expired;
      removePollFromDLL(_id);
      return;
    }

    if (_poll.state == PollState.Active) {
      int256 result = calcVoteDifference(_id);
      // check for instant approval
      if (result >= instantApprovalPct) {
        polls[_id].state = PollState.Accepted;
        removePollFromDLL(_id);
      } else {
        if(_poll.endDate < now) {
          if (result >= approvalPtc) {
            polls[_id].state = PollState.Accepted;
          } else {
            polls[_id].state = PollState.Rejected;
          }
          removePollFromDLL(_id);
        }
      }
    }
  }

  // Call when voting time has passed or instantApprovalPct is reached
  function processMemberUpdatePoll(uint256 _id) public {
    updatePoll(_id);
    require(polls[_id].state == PollState.Accepted, "Wrong poll state!");
    require(polls[_id].pType == PollType.MemberUpdate, "Wrong poll type!");

    address addr = pollsMemberUpdateData[_id].addr;
    assert(addr != 0x0000000000000000000000000000000000000000);

    processMemberUpdate(_id);
    polls[_id].state = PollState.Finalized;
  }

  function processMemberUpdate(uint256 _id) private {
    MemberUpdateData memory _data = pollsMemberUpdateData[_id];
    ContributorData memory _c_mem = contributors[_data.addr];
    ContributorData storage _c_storage = contributors[_data.addr];

    if (_data.idxs[3] == true) {  // bonus
      if (_c_mem.contributorsListIdx > 0) {
        validateBonus(_c_mem.bonus, _data.bonus);
        _c_storage.bonus += _data.bonus;
      } else {
        _c_storage.bonus = _data.bonus;
      }
    }

    if (_data.toRemove) {
      if (_c_mem.state == ContributorState.Active) {
        if (periodsLeft > 0 && rewardPerPeriod > 0) {
          checkForMissedPeriods();
          checkForMissedPeriodsContributor(_data.addr);
          _c_mem = contributors[_data.addr];
          if (_c_mem.nextClaimDate > now) {
            nextPeriodUsage -= _c_mem.rewardPerPeriod;
          } else {
            nextPeriodUsage -= _c_mem.rewardPerPeriod;
            undistributedCurrentPeriod -= _c_mem.rewardPerPeriod;
          }
        }
        if (_c_mem.weight > 0) {
          assert(_c_mem.isContract == false);
          totalVotingWeight -= _c_mem.weight;
          // TODO(kari): Update votes properly
          updateVotes(_data.addr, _c_mem.weight, 0);  // ! This is temporary
        }
        removeContributorFromDLL(_data.addr);
      }

      if (_c_mem.contributorsListIdx > 0) {
        _c_storage.state = ContributorState.Inactive;
        _c_storage.weight = 0;
        _c_storage.periodsLeft = 0;
        _c_storage.rewardPerPeriod = 0;
        _c_storage.nextClaimDate = 0;
      } else {
        _c_storage.state = ContributorState.Uninitialized;
        delete contributors[_data.addr];
      }
      if (_c_mem.isContract && _c_mem.state == ContributorState.Active && _c_mem.periodsLeft > 0) {
        // TODO(kari): Notify the subproject of the change??
      }
      return;
    }

    if (_c_mem.state == ContributorState.Inactive && (_data.idxs[0] || _data.idxs[1] || _data.idxs[2])) {
      _c_storage.state = ContributorState.Invited;
      _c_storage.weight = _data.idxs[0] ? _data.weight : _c_mem.weight;
      _c_storage.periodsLeft = _data.idxs[1] ? _data.periodsLeft : _c_mem.periodsLeft;
      _c_storage.rewardPerPeriod = _data.idxs[2] ? _data.rewardPerPeriod : _c_mem.rewardPerPeriod;
      if (_c_mem.isContract) {
        validateParametersOnJoin(_data.addr);
      }
      return;
    } else if (_c_mem.state == ContributorState.Uninitialized || _c_mem.state == ContributorState.Invited) {
      _c_storage.state = ContributorState.Invited;
      _c_storage.weight = _data.idxs[0] ? _data.weight : _c_mem.weight;
      _c_storage.periodsLeft = _data.idxs[1] ? _data.periodsLeft : _c_mem.periodsLeft;
      _c_storage.rewardPerPeriod = _data.idxs[2] ? _data.rewardPerPeriod : _c_mem.rewardPerPeriod;
      if (_c_mem.isContract) {
        validateParametersOnJoin(_data.addr);
      }
      return;
    }

    // ======== Memeber is Active ========

    if (_data.idxs[1] || _data.idxs[2]) {
      checkForMissedPeriods();
      checkForMissedPeriodsContributor(_data.addr);
      uint256 _nextClaimDate = nextClaimDate;
      require(_nextClaimDate > now || _nextClaimDate == 0, "For proper calculation of available resources project should claim its reward first");
      _c_mem = contributors[_data.addr];
    }

    if (_data.idxs[0] == true) {  // weight
      assert(_c_mem.isContract == false);
      validateWeight(_c_mem.weight, _data.weight);
      _c_storage.weight = _data.weight;
      updateVotes(_data.addr, _c_mem.weight, _data.weight);
    }

    if (_data.idxs[1] == true) {  // periodsLeft
      validatePeriods(_data.addr, _c_mem.periodsLeft, _data.periodsLeft, _c_mem.rewardPerPeriod, _c_mem.nextClaimDate);
      _c_storage.periodsLeft = _data.periodsLeft;
    }

    if (_data.idxs[2] == true) {  // rewardPerPeriod
      _c_mem = contributors[_data.addr];
      validateReward(_c_mem.rewardPerPeriod, _data.rewardPerPeriod, _c_mem.periodsLeft, _c_mem.nextClaimDate);
      _c_storage.rewardPerPeriod = _data.rewardPerPeriod;
    }

    if (_c_mem.isContract && (_data.idxs[1] || _data.idxs[2])) {
      // TODO(kari): Notify the subproject of the change
    }
  }

  function validateParametersOnJoin(address addr) private {
    ContributorData memory _c_mem = contributors[addr];

    if (_c_mem.periodsLeft > 0 || _c_mem.rewardPerPeriod > 0) {
      checkForMissedPeriods();
    }

    // weight
    if (_c_mem.weight > 0) {
      assert(_c_mem.isContract == false);
      validateWeight(0, _c_mem.weight);
    }

    // periods
    if (_c_mem.periodsLeft > 0) {
      validatePeriods(addr, 0, _c_mem.periodsLeft, 0, 0);
    }

    // reward per period
    if (_c_mem.rewardPerPeriod > 0) {
      _c_mem = contributors[addr];
      validateReward(0, _c_mem.rewardPerPeriod, _c_mem.periodsLeft, _c_mem.nextClaimDate);
    }

    // bonus
    if (_c_mem.bonus > 0) {
      if (_c_mem.contributorsListIdx == 0) {
        validateBonus(0, _c_mem.bonus);
      }
    }
  }

  function validateBonus(uint128 _oldValue, uint128 _newValue) private {
    uint256 _available = getBonusAvailability();
    require(_newValue <= _available);
    require(_oldValue + _newValue > _oldValue, "Overflow!");
    uint256 _distributedBonuses = distributedBonuses;
    require(_distributedBonuses + _newValue > _distributedBonuses, "Overflow!");
    distributedBonuses += _newValue;
  }

  function validatePeriods(address _addr, uint128 _oldValue, uint128 _newValue, uint128 _oldReward, uint256 _nextClaimDateMember) private {
    ContributorData storage _c_storage = contributors[_addr];
    uint256 _periodsLeft = periodsLeft;
    uint256 _nextClaimDate = nextClaimDate;
    bool isProjectMidPeriod = _nextClaimDate > 0 && _nextClaimDate - PERIOD_LENGTH < now;
    bool isMemberMidPeriod = _nextClaimDateMember > 0 && _nextClaimDateMember - PERIOD_LENGTH < now;
    // Cannot be hired for more periods than the project's
    require(_newValue < _periodsLeft || (_newValue == _periodsLeft && !isProjectMidPeriod));

    if (_oldValue > 0) {
      if (_newValue == 0) {
        require(!isMemberMidPeriod);
        nextPeriodUsage -= _oldReward;
        _c_storage.rewardPerPeriod = 0;
        _c_storage.nextClaimDate = 0;
      }
    } else {  // _oldValue == 0
      assert(_oldReward == 0);
      if (_newValue > 0) {
        _c_storage.nextClaimDate = _nextClaimDate + (isProjectMidPeriod ? 1 : 0) * PERIOD_LENGTH;
      }
    }
  }

  function validateReward(uint128 _oldValue, uint128 _newValue, uint128 _periodsLeftMember, uint256 _nextClaimDateMember) private {
    uint256 _nextPeriodUsage = nextPeriodUsage;
    uint256 _rewardPerPeriod = rewardPerPeriod;

    if (_oldValue > 0) {
      assert(_periodsLeftMember > 0 && _nextClaimDateMember > 0);
      // if the member currently receives a reward, they must first claim it before change the next period usage
      require(_nextClaimDateMember > now, "Member should claim their previous reward first!");
      _nextPeriodUsage -= _oldValue;
    }
    if (_newValue > 0) {
      require(_periodsLeftMember > 0, "PeriodsLeft must be set!");
      require(_nextPeriodUsage + _newValue > _nextPeriodUsage &&  // Overflow!
              _nextPeriodUsage + _newValue <= _rewardPerPeriod);  //
      _nextPeriodUsage += _newValue;
    }
    nextPeriodUsage = _nextPeriodUsage;
  }

  function validateWeight(uint128 _oldValue, uint128 _newValue) private {
    uint256 _totalVotingWeight = totalVotingWeight;
    _totalVotingWeight -= _oldValue;
    require(_totalVotingWeight + _newValue > _totalVotingWeight, "Overflow!");
    _totalVotingWeight += _newValue;
    totalVotingWeight = _totalVotingWeight;
  }

  function join(
      uint256 _pollId,
      uint128 _weight,
      uint128 _periodsLeft,
      uint128 _rewardPerPeriod,
      uint128 _bonus) public validPollID(_pollId) {
    Poll memory _poll = polls[_pollId];
    MemberUpdateData memory _data = pollsMemberUpdateData[_pollId];
    require(msg.sender == _data.addr, "Invalid msg sender!");  // This will fail also if the poll is of a wrong type
    require(_data.toRemove == false);

    if (_poll.state == PollState.Finalized) {
      require(_poll.endDate + pollValidity > now);  // ensure that it is not expired
      processMemberUpdate(_pollId);
    } else {
      processMemberUpdatePoll(_pollId);  // also verifies type
    }
    require(polls[_pollId].state == PollState.Finalized);

    ContributorData memory _c_mem = contributors[_data.addr];
    ContributorData storage _c_storage = contributors[_data.addr];

    require(_c_mem.state == ContributorState.Invited, "Invalid contributor state!");
    require(_c_mem.weight == _weight, "Invalid argumet: weight!");
    require(_c_mem.periodsLeft == _periodsLeft, "Invalid argumet: periodsLeft!");
    require(_c_mem.rewardPerPeriod == _rewardPerPeriod, "Invalid argumet: rewardPerPeriod!");
    require(_c_mem.bonus == _bonus, "Invalid argumet: bonus!");

    validateParametersOnJoin(_data.addr);

    if (_c_mem.contributorsListIdx == 0) {
      contributorsList.push(_data.addr);
      _c_storage.contributorsListIdx = uint248(contributorsList.length - 1);
      assert(uint256(uint248(contributorsList.length - 1)) == contributorsList.length - 1);
    }

    _c_storage.state = ContributorState.Active;
    addContributorToDLL(_data.addr);
  }

  function processParameterChangePoll(uint256 _id) public {}  // Version 2

  function processBonusDitributionPoll(uint256 _id, uint256 _loopSize) public {
    updatePoll(_id);
    require(polls[_id].state == PollState.Accepted, "Wrong poll state!");
    require(polls[_id].pType == PollType.BonusDitribution, "Wrong poll type!");
    uint256 _bonusDitributionInProgress = bonusDitributionInProgress;
    if (_bonusDitributionInProgress != 0) {
      require(_bonusDitributionInProgress == _id, "Another bonus distribution is in progress!");
    } else {
      bonusDitributionInProgress = _id;
    }

    BonusDitributionData storage _strg_data = pollsBonusDitributionData[_id];
    BonusDitributionData memory _mem_data = pollsBonusDitributionData[_id];
    require(_mem_data.sum <= undistributedBonus, "Insufficient amount!");
    uint256 sum = _mem_data.sum;
    uint256 distributed = sum;
    address[] memory _contributors = _mem_data.contributors;
    uint256 _lastIdx = _contributors.length > _loopSize ? _contributors.length - _loopSize : 0;
    uint256 i;
    address _current;
    uint256 _val;

    for (i = _contributors.length - 1; i >= _lastIdx; i--) {
      _current = _contributors[i];
      _val = _strg_data.values[_current];

      // TODO(kari): what to do (if anything) if overflow?
      // 1) Skipping a member means pop() cannot be used
      // 2) If there is an overflow and functon return (require(contributors[_current].bonus + _val >
      // contributors[_current].bonus)), other members wouldn't be able to get their bonuses before
      // the current member calls claim
      contributors[_current].bonus += uint128(_val);
      sum -= _val;

      _strg_data.values[_current] = 0;
      _strg_data.contributors.pop();  // ??
    }
    // Update
    distributed -= sum;
    undistributedBonus -= distributed;
    distributedBonuses += distributed;
    _strg_data.sum = sum;

    // If there are no more left
    if (_lastIdx == 0) {
      polls[_id].state = PollState.Finalized;
      bonusDitributionInProgress = 0;
    }
  }

  // Sponsor interface

  function withdrawReward(uint256 _value) override external {}

  function claimReward(uint256 _value) override external
      returns (uint128 _monthlyReward, uint128 _bonus) {}

  // Testing

  constructor(
      Sponsor _sponsor, uint128 _periodsLeft, uint128 _rewardPerPeriod, uint256 _nextClaimDate) public {
    sponsor = _sponsor;
    periodsLeft = _periodsLeft;
    rewardPerPeriod = _rewardPerPeriod;
    nextClaimDate = _nextClaimDate;
  }

  function addContributor() public {}

  function setIsActive(bool newValue) public {
    isActive = newValue;
  }

  function setSponsor(Sponsor newValue) public {
    sponsor = newValue;
  }

  function setPeriodsLeft(uint128 newValue) public {
    periodsLeft = newValue;
  }

  function setRewardPerPeriod(uint128 newValue) public {
    rewardPerPeriod = newValue;
  }

  function setNextClaimDate(uint256 newValue) public {
    nextClaimDate = newValue;
  }
}
