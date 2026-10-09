// Fraud scoring is numeric heuristics over device/IP/behavioral signals.
// Cast precision and sign-loss are bounded by the [0..=1] clamps every
// scorer applies. The noisy doc lints (backticks, # Errors sections) are
// suppressed because the public surface is fully exercised by the gRPC
// proto definitions and integration tests.
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::missing_errors_doc,
    clippy::doc_markdown,
    clippy::missing_const_for_fn,
    clippy::similar_names,
    clippy::module_name_repetitions,
    clippy::suboptimal_flops,
    clippy::collapsible_if,
    clippy::match_same_arms,
    clippy::implicit_hasher,
    clippy::redundant_clone,
    clippy::map_unwrap_or,
    clippy::option_if_let_else,
    clippy::needless_pass_by_value,
    clippy::too_many_lines,
    clippy::manual_let_else,
    clippy::doc_overindented_list_items,
    clippy::result_large_err,
    clippy::trivially_copy_pass_by_ref,
    clippy::must_use_unit,
    clippy::must_use_candidate,
    clippy::type_complexity,
    clippy::unreadable_literal,
    clippy::unused_self,
    clippy::double_must_use
)]

pub mod behavioral;
pub mod models;
