// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @notice The BinarySettlement redemption singleton.
 * @dev Signatures from `binarySettlementAbi` in the markets-sdk 0.28.1 package.
 *      Testnet and mainnet share the address: 0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23
 */
interface IBinarySettlement {
    /// @notice Burn `amount` of a settled outcome, send collateral to `to`.
    function redeem(uint256 outcomeId, uint256 amount, address to) external returns (uint256 collateralOut);

    /// @notice As `redeem`, but finalizes the market first if nobody has yet.
    function finalizeAndRedeem(address pool, uint256 outcomeId, uint256 amount, address to)
        external
        returns (uint256 collateralOut);
}
