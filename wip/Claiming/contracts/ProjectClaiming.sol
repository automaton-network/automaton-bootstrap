pragma solidity ^0.6.2;

interface Sponsor {
  function claim(uint128 _value) external
      returns (uint128 _monthlyReward, uint128 _oneTimeReward, uint128 _bonus);
  function withdraw(uint256 _value) external;
}

/*
TODO(kari):
1. Think of situations where
   - project has no active members (there will be no one to vote)
   - project has only subprojects as members (there will be no one to vote)
   - there is no sponsor
*/

contract ProjectClaiming is Sponsor {
  uint256 constant PERIOD_LENGTH = 1 weeks;

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
  Sponsor public sponsor;
  uint128 public periodsLeft;
  uint128 public rewardPerPeriod;
  uint256 public nextClaimDate;  // Beggining of the next period

  // TODO(kari): Proper calculation of current usage. Approved bonuses and one-time payments shouldn't exceed
  // what's really available

  uint256 public claimed;  // claimed but not withdrawn, to be used when claiming and returning money to sponsor
  uint256 public distributedBonuses;  // given bonuses to contributors that are not yet claimed
  uint256 public undistributedBonus;  // to be distributed through special voting

  mapping (address => uint256) public balances;

  function checkForMissedPeriods() public {
    uint256 _nextClaimDate = nextClaimDate;
    uint128 _periodsLeft = periodsLeft;
    if (_nextClaimDate > 0 && _nextClaimDate + PERIOD_LENGTH < now) {
      uint256 missedPeriods = (now - _nextClaimDate) / PERIOD_LENGTH;
      if (missedPeriods >= _periodsLeft) {
        _nextClaimDate = 0;
        _periodsLeft = 0;
      } else {
        _nextClaimDate += missedPeriods * PERIOD_LENGTH;
        _periodsLeft -= uint128(missedPeriods);
      }

      nextClaimDate = _nextClaimDate;
      periodsLeft = _periodsLeft;
    }
  }

  function claimAndWithdrawFromSponsor() public
      returns (uint128 _monthlyReward, uint128 _oneTimeReward, uint128 _bonus) {
   // TODO(kari): there MUST be at least 1 active member

    checkForMissedPeriods();

    uint256 _currentValue = address(this).balance;
    uint256 _nextClaimDate = nextClaimDate;
    uint128 _periodsLeft = periodsLeft;
    uint128 valueToClaim = 0;

    if (_nextClaimDate > 0 && _nextClaimDate <= now) {
      if (_periodsLeft > 0 ) {
        uint256 needed = rewardPerPeriod + claimed + distributedBonuses + undistributedBonus;
        if (_currentValue < needed) {
          valueToClaim = uint128(needed - _currentValue);
        }
        _nextClaimDate += PERIOD_LENGTH;
        _periodsLeft--;
      } else {
        // There are no periods left and the bonus period for everybody to claim their reward has passed.
        // Now unused rewards could be returned to the sponsor
        _nextClaimDate = 0;
      }
    }
    nextClaimDate = _nextClaimDate;
    periodsLeft = _periodsLeft;

    (_monthlyReward, _oneTimeReward, _bonus) = sponsor.claim(valueToClaim);

    // require(_monthlyReward + _oneTimeReward + _bonus > 0, "Wrong amount");
    if (_monthlyReward + _oneTimeReward + _bonus > 0) {
      sponsor.withdraw(_monthlyReward + _oneTimeReward + _bonus);
    }

    require(_monthlyReward + _oneTimeReward + _bonus >= valueToClaim, "Error1");
    require(_currentValue + _monthlyReward + _oneTimeReward + _bonus == address(this).balance, "Error2");

    if (_bonus > 0) {
      require(undistributedBonus + _bonus > undistributedBonus, "Overflow!");
      undistributedBonus += _bonus;
    }
  }

  function claim(uint128 _value) external override
      returns (uint128 _monthlyReward, uint128 _oneTimeReward, uint128 _bonus) {
    ContributorData memory contributor = contributors[msg.sender];
    require(contributor.state > ContributorState.Invited, "Wrong contrubutor state!");

    // Check if project has missed periods
    checkForMissedPeriods();

    // Check if contributor has missed periods
    if (contributor.nextClaimDate > 0 && contributor.nextClaimDate + PERIOD_LENGTH < now) {
      uint256 missedPeriods = (now - contributor.nextClaimDate) / PERIOD_LENGTH;
      if (missedPeriods >= contributor.periodsLeft) {
        contributor.nextClaimDate = 0;
        contributor.periodsLeft = 0;
      } else {
        contributor.nextClaimDate += missedPeriods * PERIOD_LENGTH;
        contributor.periodsLeft -= uint128(missedPeriods);
      }
      // one time rewards are only valid within the same period as given
      contributors[msg.sender].oneTimeReward = 0;
      contributor.oneTimeReward = 0;
    }


    if (contributor.nextClaimDate > 0 && contributor.nextClaimDate <= now) {
      assert(contributor.periodsLeft > 0);
      if (_value > 0 && _value < contributor.rewardPerPeriod) {
        // Claim partial reward
        _monthlyReward = _value;
      } else {
        // Claim full period reward
        _monthlyReward = contributor.rewardPerPeriod;
      }
      if (contributor.periodsLeft > 1) {
        contributors[msg.sender].nextClaimDate = contributor.nextClaimDate + PERIOD_LENGTH;
        contributors[msg.sender].periodsLeft = contributor.periodsLeft - 1;
      } else {  //contributor.periodsLeft == 1
        contributors[msg.sender].nextClaimDate = 0;
        contributors[msg.sender].periodsLeft = 0;
      }
    }

    if (contributor.oneTimeReward > 0) {
      _oneTimeReward = contributor.oneTimeReward;
      contributors[msg.sender].oneTimeReward = 0;
    }

    if (contributor.bonus > 0) {
      _bonus = contributor.bonus;
      contributors[msg.sender].bonus = 0;
      // distributedBonuses -= contributor.bonus;
    }

    uint256 valueToClaim = _monthlyReward + _oneTimeReward + _bonus;
    if (valueToClaim > 0) {
      uint256 _claimed = claimed;
      require(balances[msg.sender] + valueToClaim > balances[msg.sender], "Overflow!");
      require(_claimed + valueToClaim > _claimed, "Overflow!");
      claimed += valueToClaim;
      balances[msg.sender] += valueToClaim;
    }
  }

  function returnUnusedToSponsor() public {
    checkForMissedPeriods();

    uint256 _nextClaimDate = nextClaimDate;
    uint256 _periodsLeft = periodsLeft;

    if (_periodsLeft > 0 || _nextClaimDate > now) {
      return;
    }
    nextClaimDate = 0;

    uint256 needed = claimed + distributedBonuses + undistributedBonus;
    uint256 _currentValue = address(this).balance;
    uint256 valueToReturn = 0;

    if (_currentValue > needed) {
      valueToReturn = _currentValue - needed;
    }

    if (address(sponsor) != address(0) && valueToReturn > 0) {
      (bool success, ) = address(sponsor).call.value(valueToReturn)("");
      require(success);
    }
  }

  function withdraw(uint256 _value) external override {
    require(_value <= balances[msg.sender]);
    balances[msg.sender] -= _value;
    claimed -= _value;
    (bool success, ) = msg.sender.call.value(_value)("");
    require(success, "Withdraw error!");
  }

  //
  receive() external payable {
    if (msg.sender != address(sponsor) && contributors[msg.sender].state == ContributorState.Invalid) {
      undistributedBonus += msg.value;
    }
  }

  // Others

  function updateContributorData(
      address _addr,
      ContributorState _state,
      uint256 _nextClaimDate,
      uint128 _periodsLeft,
      uint128 _rewardPerPeriod,
      uint128 _oneTimeReward,
      uint128 _bonus,
      uint256 _weight,
      bool _isContract) private {}

  // Testing

  constructor(
      Sponsor _sponsor, uint128 _periodsLeft, uint128 _rewardPerPeriod, uint256 _nextClaimDate) public {
    sponsor = _sponsor;
    periodsLeft = _periodsLeft;
    rewardPerPeriod = _rewardPerPeriod;
    nextClaimDate = _nextClaimDate;
  }

  function addContributor(
      address _addr,
      bool _isContract,
      uint128 _weight,
      uint256 _nextClaimDate,
      uint128 _periodsLeft,
      uint128 _rewardPerPeriod,
      uint128 _oneTimeReward,
      uint128 _bonus) public {

    ContributorData storage c = contributors[_addr];
    c.state = ContributorState.Active;
    c.isContract = _isContract;
    c.weight = _weight;
    c.nextClaimDate = _nextClaimDate;
    c.periodsLeft = _periodsLeft;
    c.rewardPerPeriod = _rewardPerPeriod;
    c.oneTimeReward = _oneTimeReward;
    c.bonus = _bonus;
    // distributedBonuses += _bonus;
  }

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
