use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
};
use crate::AmmError;

/// Canonical SPL Token Program ID: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
pub const SPL_TOKEN_ID: Pubkey = Pubkey::new_from_array([
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237,
    95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
]);

/// Canonical SPL Token-2022 Program ID: `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`
pub const TOKEN_2022_ID: Pubkey = Pubkey::new_from_array([
    6, 221, 246, 225, 238, 117, 143, 222, 24, 66, 93, 188, 228, 108, 205, 218, 182, 26, 252, 77,
    131, 185, 13, 39, 254, 189, 249, 40, 216, 161, 139, 252,
]);

/// Token-2022 TLV ExtensionType::NonTransferable discriminator
pub const EXT_NON_TRANSFERABLE: u16 = 9;

pub fn is_supported_token_program(key: &Pubkey) -> bool {
    *key == SPL_TOKEN_ID || *key == TOKEN_2022_ID
}

#[derive(Clone, Copy, Debug)]
pub struct ParsedMint {
    pub mint_authority: Option<Pubkey>,
    pub supply: u64,
    pub decimals: u8,
    pub is_token_2022: bool,
    pub is_non_transferable: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct ParsedTokenAccount {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}

pub fn parse_mint(mint_info: &AccountInfo) -> Result<ParsedMint> {
    require!(
        is_supported_token_program(mint_info.owner),
        AmmError::UnsupportedTokenProgram
    );
    let data = mint_info.try_borrow_data()?;
    require!(data.len() >= 82 && data[45] == 1, AmmError::InvalidMintAccount);

    let coption_tag = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    let mint_authority = if coption_tag == 1 {
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&data[4..36]);
        Some(Pubkey::new_from_array(arr))
    } else {
        None
    };

    let mut sup_bytes = [0u8; 8];
    sup_bytes.copy_from_slice(&data[36..44]);
    let supply = u64::from_le_bytes(sup_bytes);
    let decimals = data[44];
    let is_token_2022 = *mint_info.owner == TOKEN_2022_ID;

    let mut is_non_transferable = false;
    if is_token_2022 && data.len() > 166 && data[165] == 1 {
        let mut offset = 166usize;
        while offset + 4 <= data.len() {
            let ext_type = u16::from_le_bytes([data[offset], data[offset + 1]]);
            let ext_len = u16::from_le_bytes([data[offset + 2], data[offset + 3]]) as usize;
            if ext_type == 0 {
                break;
            }
            if ext_type == EXT_NON_TRANSFERABLE {
                is_non_transferable = true;
                break;
            }
            offset = offset.saturating_add(4).saturating_add(ext_len);
        }
    }

    Ok(ParsedMint {
        mint_authority,
        supply,
        decimals,
        is_token_2022,
        is_non_transferable,
    })
}

pub fn parse_token_account(acct_info: &AccountInfo) -> Result<ParsedTokenAccount> {
    require!(
        is_supported_token_program(acct_info.owner),
        AmmError::UnsupportedTokenProgram
    );
    let data = acct_info.try_borrow_data()?;
    require!(
        data.len() >= 165 && data[108] == 1,
        AmmError::InvalidTokenAccount
    );

    let mut mint_arr = [0u8; 32];
    mint_arr.copy_from_slice(&data[0..32]);
    let mut owner_arr = [0u8; 32];
    owner_arr.copy_from_slice(&data[32..64]);
    let mut amt_arr = [0u8; 8];
    amt_arr.copy_from_slice(&data[64..72]);

    Ok(ParsedTokenAccount {
        mint: Pubkey::new_from_array(mint_arr),
        owner: Pubkey::new_from_array(owner_arr),
        amount: u64::from_le_bytes(amt_arr),
    })
}

/// Executes SPL Token / Token-2022 `TransferChecked` (instruction tag 12)
#[allow(clippy::too_many_arguments)]
pub fn transfer_checked<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    require!(
        is_supported_token_program(token_program.key) && token_program.key == mint.owner,
        AmmError::UnsupportedTokenProgram
    );
    let mut ix_data = [0u8; 10];
    ix_data[0] = 12; // TokenInstruction::TransferChecked
    ix_data[1..9].copy_from_slice(&amount.to_le_bytes());
    ix_data[9] = decimals;

    let ix = Instruction {
        program_id: *token_program.key,
        accounts: vec![
            AccountMeta::new(*from.key, false),
            AccountMeta::new_readonly(*mint.key, false),
            AccountMeta::new(*to.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        data: ix_data.to_vec(),
    };

    let account_infos = [
        from.clone(),
        mint.clone(),
        to.clone(),
        authority.clone(),
        token_program.clone(),
    ];

    if signer_seeds.is_empty() {
        invoke(&ix, &account_infos)?;
    } else {
        invoke_signed(&ix, &account_infos, signer_seeds)?;
    }
    Ok(())
}
