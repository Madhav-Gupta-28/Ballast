// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @notice The ERC-6909 singleton every DreamDEX outcome token lives on.
 * @dev Outcome positions are ids on ONE shared contract, not per-market ERC-20s.
 *      Read a leg with balanceOf(owner, id) — never a per-market balanceOf().
 *      Pools recycle (nonce -> ids) across windows, so ids must be refreshed
 *      from the market snapshot rather than cached. ARCHITECTURE.md §7.
 */
interface IOutcomeToken {
    function balanceOf(address owner, uint256 id) external view returns (uint256);

    /// @notice One approval covers both legs for a given pool.
    function setOperator(address spender, bool approved) external returns (bool);
}
