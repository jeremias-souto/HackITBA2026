// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Owner.sol";
import "./Guardian.sol";
import "./Heir.sol";

/// @title StrongBox
/// @notice Caja fuerte que almacena fondos nativos y permite:
///         - depósitos del owner,
///         - retiros del owner validados por 2 guardianes,
///         - reclamo por inactividad de 2 heirs,
///         - consulta de balance por parte del owner.
contract StrongBox is Owner {
    /// @notice Estructura para solicitudes de retiro pendientes.
    /// @dev Se respetó la estructura pedida. Aunque los nombres guardian1Approved/guardian2Approved
    ///      son confusos, en la práctica representan aprobación del guardián 1 y guardián 2.
    struct WithdrawalRequest {
        uint256 amount;
        address to;
        bool guardian1Approved;
        bool guardian2Approved;
        bool executed;
    }

    /// @dev Contrato que conoce a los guardianes.
    Guardian private guardianContract;

    /// @dev Contrato que conoce a los heirs.
    Heir private heirContract;

    /// @dev Último momento en que el owner interactuó mediante depósito o solicitud de retiro.
    uint256 private lastTimeUsed;

    /// @dev Tiempo máximo de inactividad permitido.
    uint256 private immutable timeLimit;

    /// @dev Contador incremental de solicitudes de retiro.
    uint256 private withdrawalRequestCount;

    /// @dev Mapeo de id => solicitud de retiro.
    mapping(uint256 => WithdrawalRequest) private withdrawalRequests;

    /// @dev Solo permitimos una solicitud activa a la vez para simplificar la lógica y aumentar seguridad.
    uint256 private activeWithdrawalRequestId;
    bool private hasActiveWithdrawalRequest;

    /// @dev Marca si una solicitud fue cancelada/rechazada.
    mapping(uint256 => bool) private cancelledWithdrawalRequests;

    /// @dev Indica si el heir1 ya reclamó su parte.
    bool private heir1Claimed;

    /// @dev Indica si el heir2 ya reclamó su parte.
    bool private heir2Claimed;

    /// @dev Snapshot del monto total a distribuir al momento del primer reclamo.
    uint256 private inheritanceSnapshotBalance;

    /// @dev Indica si ya se tomó el snapshot del balance heredable.
    bool private inheritanceSnapshotTaken;

    // -------------------------------------------------------------------------
    // Errores
    // -------------------------------------------------------------------------

    error InvalidAddress(address account);
    error InvalidAmount(uint256 amount);
    error InvalidTimeLimit(uint256 timeLimit);
    error NotGuardian(address caller);
    error NotHeir(address caller);
    error RequestDoesNotExist(uint256 requestId);
    error RequestAlreadyExecuted(uint256 requestId);
    error RequestAlreadyCancelled(uint256 requestId);
    error RequestAlreadyApproved(uint256 requestId, address guardian);
    error NoActiveWithdrawalRequest();
    error ActiveWithdrawalRequestExists(uint256 requestId);
    error InsufficientBalance(uint256 requested, uint256 available);
    error TransferFailed(address to, uint256 amount);
    error AlreadyClaimed(address heir);
    error NothingToClaim();
    error TimeLimitNotReached(uint256 currentTime, uint256 requiredTime);

    // -------------------------------------------------------------------------
    // Eventos
    // -------------------------------------------------------------------------

    event DepositMade(address indexed from, uint256 amount, uint256 newBalance);
    event WithdrawalRequested(
        uint256 indexed requestId,
        address indexed owner,
        address indexed to,
        uint256 amount
    );
    event WithdrawalApproved(
        uint256 indexed requestId,
        address indexed guardian
    );
    event WithdrawalRejected(
        uint256 indexed requestId,
        address indexed guardian
    );
    event WithdrawalExecuted(
        uint256 indexed requestId,
        address indexed to,
        uint256 amount
    );
    event LastTimeUpdated(uint256 indexed previousTime, uint256 indexed newTime);
    event InheritanceClaimed(
        address indexed heir,
        uint256 amount
    );

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param initialOwner Dirección del owner de la caja fuerte.
    /// @param guardianAddress Dirección del contrato Guardian asociado.
    /// @param heirAddress Dirección del contrato Heir asociado.
    /// @param _timeLimit Tiempo máximo de inactividad para habilitar inherit().
    constructor(
        address initialOwner,
        address guardianAddress,
        address heirAddress,
        uint256 _timeLimit
    ) Owner(initialOwner) {
        if (guardianAddress == address(0)) revert InvalidAddress(guardianAddress);
        if (heirAddress == address(0)) revert InvalidAddress(heirAddress);
        if (_timeLimit == 0) revert InvalidTimeLimit(_timeLimit);

        guardianContract = Guardian(guardianAddress);
        heirContract = Heir(heirAddress);
        timeLimit = _timeLimit;
        lastTimeUsed = block.timestamp;
    }

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    /// @notice Restringe el acceso solo a uno de los guardianes.
    modifier onlyGuardian() {
        if (!guardianContract.isGuardian(msg.sender)) {
            revert NotGuardian(msg.sender);
        }
        _;
    }

    /// @notice Restringe el acceso solo a uno de los heirs.
    modifier onlyHeir() {
        if (!heirContract.isHeir(msg.sender)) {
            revert NotHeir(msg.sender);
        }
        _;
    }

    /// @notice Permite ejecutar solo cuando pasó el tiempo de inactividad.
    modifier onlyAfterTime() {
        uint256 requiredTime = lastTimeUsed + timeLimit;
        if (block.timestamp < requiredTime) {
            revert TimeLimitNotReached(block.timestamp, requiredTime);
        }
        _;
    }

    /// @notice Verifica que exista una solicitud de retiro.
    modifier validRequest(uint256 requestId) {
        if (requestId == 0 || requestId > withdrawalRequestCount) {
            revert RequestDoesNotExist(requestId);
        }
        _;
    }

    /// @notice Verifica que una solicitud siga abierta.
    modifier requestOpen(uint256 requestId) {
        if (withdrawalRequests[requestId].executed) {
            revert RequestAlreadyExecuted(requestId);
        }
        if (cancelledWithdrawalRequests[requestId]) {
            revert RequestAlreadyCancelled(requestId);
        }
        _;
    }

    /// @notice Asegura que no haya otra solicitud activa de retiro.
    modifier noActiveRequest() {
        if (hasActiveWithdrawalRequest) {
            revert ActiveWithdrawalRequestExists(activeWithdrawalRequestId);
        }
        _;
    }

    // -------------------------------------------------------------------------
    // Funciones principales
    // -------------------------------------------------------------------------

    /// @notice Permite al owner depositar fondos nativos en la StrongBox.
    /// @dev Solo el owner puede depositar directamente usando esta función.
    function deposit() external payable OnlyOwner {
        if (msg.value == 0) revert InvalidAmount(0);

        _updateTime();

        emit DepositMade(msg.sender, msg.value, address(this).balance);
    }

    /// @notice Crea una solicitud de retiro, que luego debe ser aprobada por ambos guardianes.
    /// @param amount Monto a retirar.
    /// @param to Dirección destinataria del retiro.
    function withdraw(uint256 amount, address to) external OnlyOwner noActiveRequest {
        if (to == address(0)) revert InvalidAddress(to);
        if (amount == 0) revert InvalidAmount(0);
        if (amount > address(this).balance) {
            revert InsufficientBalance(amount, address(this).balance);
        }

        withdrawalRequestCount++;

        withdrawalRequests[withdrawalRequestCount] = WithdrawalRequest({
            amount: amount,
            to: to,
            guardian1Approved: false,
            guardian2Approved: false,
            executed: false
        });

        hasActiveWithdrawalRequest = true;
        activeWithdrawalRequestId = withdrawalRequestCount;

        _updateTime();

        emit WithdrawalRequested(withdrawalRequestCount, msg.sender, to, amount);
    }

    /// @notice Permite a un guardián aprobar una solicitud de retiro.
    /// @dev Cuando ambos guardianes aprueban, el retiro se ejecuta automáticamente.
    /// @param requestId Id de la solicitud.
    function approveWithdrawal(uint256 requestId)
        external
        onlyGuardian
        validRequest(requestId)
        requestOpen(requestId)
    {
        WithdrawalRequest storage request = withdrawalRequests[requestId];

        address guardian1 = guardianContract.getGuardian1();
        address guardian2 = guardianContract.getGuardian2();

        if (msg.sender == guardian1) {
            if (request.guardian1Approved) {
                revert RequestAlreadyApproved(requestId, msg.sender);
            }
            request.guardian1Approved = true;
        } else if (msg.sender == guardian2) {
            if (request.guardian2Approved) {
                revert RequestAlreadyApproved(requestId, msg.sender);
            }
            request.guardian2Approved = true;
        } else {
            revert NotGuardian(msg.sender);
        }

        emit WithdrawalApproved(requestId, msg.sender);

        // Si ambos guardianes aprobaron, se ejecuta el retiro.
        if (request.guardian1Approved && request.guardian2Approved) {
            _executeWithdrawal(requestId);
        }
    }

    /// @notice Permite a un guardián rechazar una solicitud de retiro.
    /// @dev Si uno solo rechaza, la solicitud queda cancelada.
    /// @param requestId Id de la solicitud.
    function rejectWithdrawal(uint256 requestId)
        external
        onlyGuardian
        validRequest(requestId)
        requestOpen(requestId)
    {
        cancelledWithdrawalRequests[requestId] = true;

        if (hasActiveWithdrawalRequest && activeWithdrawalRequestId == requestId) {
            hasActiveWithdrawalRequest = false;
            activeWithdrawalRequestId = 0;
        }

        emit WithdrawalRejected(requestId, msg.sender);
    }

    /// @notice Permite consultar el balance actual del contrato.
    /// @dev Solo el owner puede consultar el balance.
    /// @return Balance del contrato en moneda nativa.
    function getBalance() external view OnlyOwner returns (uint256) {
        return address(this).balance;
    }

    /// @notice Devuelve la dirección del contrato StrongBox.
    /// @return Dirección de este contrato.
    function getAddress() external view returns (address) {
        return address(this);
    }

    /// @notice Permite a un heir reclamar fondos luego del tiempo de inactividad.
    /// @dev Cada heir reclama el 50% del balance snapshoteado al primer reclamo.
    ///      Para evitar problemas de redondeo, el segundo heir recibe el resto disponible.
    function inherit() external onlyHeir onlyAfterTime {
        if (address(this).balance == 0) revert NothingToClaim();

        address heir1 = heirContract.getHeir1();
        address heir2 = heirContract.getHeir2();

        // Tomamos snapshot una sola vez, en el primer reclamo.
        if (!inheritanceSnapshotTaken) {
            inheritanceSnapshotBalance = address(this).balance;
            inheritanceSnapshotTaken = true;
        }

        uint256 halfShare = inheritanceSnapshotBalance / 2;
        uint256 amountToSend;

        if (msg.sender == heir1) {
            if (heir1Claimed) revert AlreadyClaimed(msg.sender);
            heir1Claimed = true;

            // Si el otro ya cobró, este heir recibe el remanente.
            if (heir2Claimed) {
                amountToSend = address(this).balance;
            } else {
                amountToSend = halfShare;
            }
        } else if (msg.sender == heir2) {
            if (heir2Claimed) revert AlreadyClaimed(msg.sender);
            heir2Claimed = true;

            // Si el otro ya cobró, este heir recibe el remanente.
            if (heir1Claimed) {
                amountToSend = address(this).balance;
            } else {
                amountToSend = halfShare;
            }
        } else {
            revert NotHeir(msg.sender);
        }

        if (amountToSend == 0) revert NothingToClaim();
        if (amountToSend > address(this).balance) {
            amountToSend = address(this).balance;
        }

        (bool success, ) = payable(msg.sender).call{value: amountToSend}("");
        if (!success) revert TransferFailed(msg.sender, amountToSend);

        emit InheritanceClaimed(msg.sender, amountToSend);
    }

    // -------------------------------------------------------------------------
    // Getters auxiliares
    // -------------------------------------------------------------------------

    /// @notice Devuelve el id de la última solicitud creada.
    function getWithdrawalRequestCount() external view returns (uint256) {
        return withdrawalRequestCount;
    }

    /// @notice Devuelve la información de una solicitud.
    function getWithdrawalRequest(uint256 requestId)
        external
        view
        validRequest(requestId)
        returns (WithdrawalRequest memory)
    {
        return withdrawalRequests[requestId];
    }

    /// @notice Indica si una solicitud fue cancelada.
    function isWithdrawalRequestCancelled(uint256 requestId)
        external
        view
        validRequest(requestId)
        returns (bool)
    {
        return cancelledWithdrawalRequests[requestId];
    }

    /// @notice Devuelve el último timestamp de uso por parte del owner.
    function getLastTimeUsed() external view returns (uint256) {
        return lastTimeUsed;
    }

    /// @notice Devuelve el timeLimit configurado.
    function getTimeLimit() external view returns (uint256) {
        return timeLimit;
    }

    /// @notice Indica si actualmente hay una solicitud activa pendiente.
    function hasPendingWithdrawalRequest() external view returns (bool) {
        return hasActiveWithdrawalRequest;
    }

    /// @notice Devuelve el id de la solicitud activa pendiente, si existe.
    function getActiveWithdrawalRequestId() external view returns (uint256) {
        if (!hasActiveWithdrawalRequest) revert NoActiveWithdrawalRequest();
        return activeWithdrawalRequestId;
    }

    /// @notice Indica si el heir1 ya reclamó.
    function getHeir1Claimed() external view returns (bool) {
        return heir1Claimed;
    }

    /// @notice Indica si el heir2 ya reclamó.
    function getHeir2Claimed() external view returns (bool) {
        return heir2Claimed;
    }

    // -------------------------------------------------------------------------
    // Funciones internas / privadas
    // -------------------------------------------------------------------------

    /// @dev Ejecuta el retiro una vez aprobada la solicitud por ambos guardianes.
    /// @param requestId Id de la solicitud.
    function _executeWithdrawal(uint256 requestId) private {
        WithdrawalRequest storage request = withdrawalRequests[requestId];

        if (request.executed) revert RequestAlreadyExecuted(requestId);
        if (cancelledWithdrawalRequests[requestId]) revert RequestAlreadyCancelled(requestId);

        if (request.amount > address(this).balance) {
            revert InsufficientBalance(request.amount, address(this).balance);
        }

        request.executed = true;

        if (hasActiveWithdrawalRequest && activeWithdrawalRequestId == requestId) {
            hasActiveWithdrawalRequest = false;
            activeWithdrawalRequestId = 0;
        }

        (bool success, ) = payable(request.to).call{value: request.amount}("");
        if (!success) revert TransferFailed(request.to, request.amount);

        emit WithdrawalExecuted(requestId, request.to, request.amount);
    }

    /// @dev Reinicia el contador de inactividad al timestamp actual.
    function _updateTime() private {
        uint256 previousTime = lastTimeUsed;
        lastTimeUsed = block.timestamp;

        emit LastTimeUpdated(previousTime, lastTimeUsed);
    }
}