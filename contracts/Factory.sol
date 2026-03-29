// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Owner.sol";
import "./Guardian.sol";
import "./Heir.sol";
import "./StrongBox.sol";

/// @title Factory
/// @notice Contrato encargado de crear StrongBox para usuarios.
/// @dev Guarda un mapping wallet => strongBox.
///      También despliega los contratos Guardian y Heir asociados a cada StrongBox.
contract Factory is Owner {
    /// @dev Relación entre una wallet y su caja fuerte.
    mapping(address => address) private strongBoxes;

    /// @notice Se lanza cuando una wallet ya tiene una StrongBox asignada.
    /// @param wallet Dirección de la wallet consultada.
    /// @param strongBox Dirección ya asignada.
    error StrongBoxAlreadyExists(address wallet, address strongBox);

    /// @notice Se lanza cuando una wallet o StrongBox es inválida.
    /// @param account Dirección inválida.
    error InvalidAddress(address account);

    /// @notice Se lanza cuando el timeLimit es inválido.
    /// @param timeLimit Valor inválido.
    error InvalidTimeLimit(uint256 timeLimit);

    /// @notice Evento emitido al crear una nueva StrongBox.
    event StrongBoxCreated(
        address indexed wallet,
        address indexed strongBox,
        address guardianContract,
        address heirContract
    );

    /// @notice Evento emitido al modificar manualmente la asociación wallet => StrongBox.
    event StrongBoxSet(address indexed wallet, address indexed strongBox);

    /// @param initialOwner Owner de la factory.
    constructor(address initialOwner) Owner(initialOwner) {}

    /// @notice Crea una StrongBox para msg.sender si todavía no tiene una.
    /// @param guardian1 Dirección del guardián 1.
    /// @param guardian2 Dirección del guardián 2.
    /// @param heir1 Dirección del heir 1.
    /// @param heir2 Dirección del heir 2.
    /// @param timeLimit Tiempo máximo de inactividad de la StrongBox.
    /// @return strongBoxAddress Dirección de la StrongBox creada.
    function createStrongBox(
        address guardian1,
        address guardian2,
        address heir1,
        address heir2,
        uint256 timeLimit
    ) external returns (address strongBoxAddress) {
        if (msg.sender == address(0)) revert InvalidAddress(msg.sender);
        if (timeLimit == 0) revert InvalidTimeLimit(timeLimit);

        if (strongBoxes[msg.sender] != address(0)) {
            revert StrongBoxAlreadyExists(msg.sender, strongBoxes[msg.sender]);
        }

        // Despliega contratos auxiliares de guardianes y heirs.
        Guardian guardianContract = new Guardian(guardian1, guardian2);
        Heir heirContract = new Heir(heir1, heir2);

        // Despliega la StrongBox asociada al usuario.
        StrongBox strongBox = new StrongBox(
            msg.sender,
            address(guardianContract),
            address(heirContract),
            timeLimit
        );

        strongBoxAddress = address(strongBox);
        strongBoxes[msg.sender] = strongBoxAddress;

        emit StrongBoxCreated(
            msg.sender,
            strongBoxAddress,
            address(guardianContract),
            address(heirContract)
        );
    }

    /// @notice Devuelve la dirección de StrongBox asociada a una wallet.
    /// @param wallet Dirección de la wallet.
    /// @return Dirección de la StrongBox o address(0) si no tiene.
    function getStrongBox(address wallet) external view returns (address) {
        return strongBoxes[wallet];
    }

    /// @notice Asigna manualmente una dirección de StrongBox a una wallet.
    /// @dev Solo el owner de la Factory puede hacerlo.
    /// @param wallet Dirección de la wallet.
    /// @param strongBox Dirección de la StrongBox.
    function setStrongBox(address wallet, address strongBox) external OnlyOwner {
        if (wallet == address(0)) revert InvalidAddress(wallet);
        if (strongBox == address(0)) revert InvalidAddress(strongBox);

        strongBoxes[wallet] = strongBox;

        emit StrongBoxSet(wallet, strongBox);
    }
}