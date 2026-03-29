// Human-readable ABIs for Ethers.js
const FACTORY_ABI = [
  "function createStrongBox(address guardian1, address guardian2, address heir1, address heir2, uint256 timeLimit) external returns (address)",
  "function getStrongBox(address wallet) external view returns (address)",
  "function setStrongBox(address wallet, address strongBox) external",
  "function getOwner() public view returns (address)",
  "event StrongBoxCreated(address indexed wallet, address indexed strongBox, address guardianContract, address heirContract)"
];

const STRONGBOX_ABI = [
  "function deposit() external payable",
  "function withdraw(uint256 amount, address to) external",
  "function approveWithdrawal(uint256 requestId) external",
  "function rejectWithdrawal(uint256 requestId) external",
  "function getBalance() external view returns (uint256)",
  "function getAddress() external view returns (address)",
  "function inherit() external",
  "function getWithdrawalRequestCount() external view returns (uint256)",
  "function getWithdrawalRequest(uint256 requestId) external view returns (uint256 amount, address to, bool guardian1Approved, bool guardian2Approved, bool executed)",
  "function isWithdrawalRequestCancelled(uint256 requestId) external view returns (bool)",
  "function getLastTimeUsed() external view returns (uint256)",
  "function getTimeLimit() external view returns (uint256)",
  "function hasPendingWithdrawalRequest() external view returns (bool)",
  "function getActiveWithdrawalRequestId() external view returns (uint256)",
  "function getHeir1Claimed() external view returns (bool)",
  "function getHeir2Claimed() external view returns (bool)",
  "function getOwner() public view returns (address)",
  "event DepositMade(address indexed from, uint256 amount, uint256 newBalance)",
  "event WithdrawalRequested(uint256 indexed requestId, address indexed owner, address indexed to, uint256 amount)",
  "event WithdrawalApproved(uint256 indexed requestId, address indexed guardian)",
  "event WithdrawalRejected(uint256 indexed requestId, address indexed guardian)",
  "event WithdrawalExecuted(uint256 indexed requestId, address indexed to, uint256 amount)",
  "event InheritanceClaimed(address indexed heir, uint256 amount)",
  "event LastTimeUpdated(uint256 indexed previousTime, uint256 indexed newTime)"
];

const GUARDIAN_ABI = [
    "function getGuardian1() external view returns (address)",
    "function getGuardian2() external view returns (address)",
    "function isGuardian(address account) external view returns (bool)"
];

const HEIR_ABI = [
    "function getHeir1() external view returns (address)",
    "function getHeir2() external view returns (address)",
    "function isHeir(address account) external view returns (bool)"
];
