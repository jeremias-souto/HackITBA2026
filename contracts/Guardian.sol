// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Guardian
/// @notice Almacena las 2 direcciones de los guardianes de una StrongBox.
/// @dev Los guardianes son los encargados de aprobar o rechazar retiros del owner.
contract Guardian {
    /// @dev Primer guardián.
    address private guardian1;

    /// @dev Segundo guardián.
    address private guardian2;

    /// @notice Error cuando una dirección recibida es inválida.
    /// @param account Dirección inválida.
    error InvalidAddress(address account);

    /// @notice Error cuando se intenta usar dos veces la misma dirección.
    error DuplicateGuardians();

    /// @param _guardian1 Dirección del primer guardián.
    /// @param _guardian2 Dirección del segundo guardián.
    constructor(address _guardian1, address _guardian2) {
        if (_guardian1 == address(0)) revert InvalidAddress(_guardian1);
        if (_guardian2 == address(0)) revert InvalidAddress(_guardian2);
        if (_guardian1 == _guardian2) revert DuplicateGuardians();

        guardian1 = _guardian1;
        guardian2 = _guardian2;
    }

    /// @notice Devuelve la dirección del primer guardián.
    function getGuardian1() external view returns (address) {
        return guardian1;
    }

    /// @notice Devuelve la dirección del segundo guardián.
    function getGuardian2() external view returns (address) {
        return guardian2;
    }

    /// @notice Indica si una dirección dada es uno de los guardianes.
    /// @param account Dirección a consultar.
    /// @return True si la dirección es guardián, false en caso contrario.
    function isGuardian(address account) external view returns (bool) {
        return account == guardian1 || account == guardian2;
    }
}