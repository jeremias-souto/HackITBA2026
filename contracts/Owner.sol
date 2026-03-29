// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Owner
/// @notice Contrato abstracto que define un owner único y un control básico de acceso.
/// @dev Provee el modifier OnlyOwner y una función pública para consultar el owner.
abstract contract Owner {
    /// @dev Dirección del owner del contrato.
    address private owner;

    /// @notice Se lanza cuando se intenta asignar un owner inválido.
    /// @param owner Dirección inválida recibida.
    error InvalidOwner(address owner);

    /// @notice Se lanza cuando una función protegida es llamada por alguien que no es el owner.
    error NotOwner();

    /// @param initialOwner Dirección inicial del owner.
    constructor(address initialOwner) {
        if (initialOwner == address(0)) {
            revert InvalidOwner(address(0));
        }
        owner = initialOwner;
    }

    /// @notice Modifier que restringe el acceso solo al owner.
    modifier OnlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Devuelve la dirección del owner actual.
    /// @return Dirección del owner.
    function getOwner() public view returns (address) {
        return owner;
    }
}