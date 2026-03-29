// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Heir
/// @notice Almacena las 2 direcciones autorizadas a reclamar fondos por inactividad.
/// @dev En tu lógica actual los llamás "heirs", aunque conceptualmente también pueden
///      representar cuentas de recuperación.
contract Heir {
    /// @dev Primera dirección autorizada.
    address private heir1;

    /// @dev Segunda dirección autorizada.
    address private heir2;

    /// @notice Error cuando una dirección recibida es inválida.
    /// @param account Dirección inválida.
    error InvalidAddress(address account);

    /// @notice Error cuando se intenta usar dos veces la misma dirección.
    error DuplicateHeirs();

    /// @param _heir1 Dirección del primer heredero/recuperador.
    /// @param _heir2 Dirección del segundo heredero/recuperador.
    constructor(address _heir1, address _heir2) {
        if (_heir1 == address(0)) revert InvalidAddress(_heir1);
        if (_heir2 == address(0)) revert InvalidAddress(_heir2);
        if (_heir1 == _heir2) revert DuplicateHeirs();

        heir1 = _heir1;
        heir2 = _heir2;
    }

    /// @notice Devuelve la dirección del primer heredero/recuperador.
    function getHeir1() external view returns (address) {
        return heir1;
    }

    /// @notice Devuelve la dirección del segundo heredero/recuperador.
    function getHeir2() external view returns (address) {
        return heir2;
    }

    /// @notice Indica si una dirección dada es uno de los herederos/recuperadores.
    /// @param account Dirección a consultar.
    /// @return True si la dirección es heredero, false en caso contrario.
    function isHeir(address account) external view returns (bool) {
        return account == heir1 || account == heir2;
    }
}