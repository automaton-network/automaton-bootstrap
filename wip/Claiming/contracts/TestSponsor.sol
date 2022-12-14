pragma solidity ^0.6.2;

interface Sponsor {
  function claim(uint128 _value) external
      returns (uint128 _rewardPerPeriod, uint128 _oneTimeReward, uint128 _bonus);
  function withdraw(uint256 _value) external;
}

contract TestSponsor is Sponsor {
  uint256 PERIOD_LENGTH = 1 weeks;
  mapping(address => uint256) public balances;
  address public sponsoredProject;
  uint256 public nextClaimDate;
  uint128 public periodsLeft;
  uint128 public rewardPerPeriod;
  uint128 public oneTimeReward;
  uint128 public bonus;

  constructor(uint256 _nextClaimDate, uint128 _periodsLeft, uint128 _rewardPerPeriod,
      uint128 _oneTimeReward, uint128 _bonus) public {
    nextClaimDate = _nextClaimDate;
    periodsLeft = _periodsLeft;
    rewardPerPeriod = _rewardPerPeriod;
    oneTimeReward = _oneTimeReward;
    bonus = _bonus;
  }

  receive() external payable {}

  function setSponsoredProject(address addr) public {
    sponsoredProject = addr;
  }

  function setNextClaimDate(uint256 _newValue) public {
   nextClaimDate = _newValue;
  }

  function setPeriodsLeft(uint128 _newValue) public {
   periodsLeft = _newValue;
  }

  function setrewardPerPeriod(uint128 _newValue) public {
   rewardPerPeriod = _newValue;
  }

  function setOneTimeReward(uint128 _newValue) public {
   oneTimeReward = _newValue;
  }

  function setBonus(uint128 _newValue) public {
   bonus = _newValue;
  }

  function claim(uint128 _value) external override
      returns (uint128 _rewardPerPeriod, uint128 _oneTimeReward, uint128 _bonus) {
    require(msg.sender == sponsoredProject);

    if (nextClaimDate <= now) {
      assert(periodsLeft > 0);
      if (_value > 0 && _value < rewardPerPeriod) {
        // Claim partial reward
        _rewardPerPeriod = _value;
      } else {
        // Claim full period reward
        _rewardPerPeriod = rewardPerPeriod;
      }
      if (periodsLeft > 1) {
        nextClaimDate += PERIOD_LENGTH;
        periodsLeft--;
      } else {  // periodsLeft == 1
        nextClaimDate = 0;
        periodsLeft = 0;
      }
    }

    if (oneTimeReward > 0) {
      _oneTimeReward = oneTimeReward;
      oneTimeReward = 0;
    }

    if (bonus > 0) {
      _bonus = bonus;
      bonus = 0;
    }

    uint256 valueToClaim = _rewardPerPeriod + _oneTimeReward + _bonus;
    if (valueToClaim > 0) {
      require(balances[msg.sender] + valueToClaim > balances[msg.sender], "Overflow!");
      balances[msg.sender] += valueToClaim;
    }
  }

  function withdraw(uint256 _value) external override {
    require(_value <= balances[msg.sender]);
    balances[msg.sender] -= _value;
    (bool success, ) = msg.sender.call.value(_value)("");
    require(success, "Withdraw error!");
  }
}
