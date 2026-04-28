#![deny(clippy::all, clippy::pedantic)]
// Bidding engine math: i64 cents and ratios across many integer/float
// boundaries. Casts are intentional and bounded by validation at request
// ingress (max bid amounts capped well within i64). Doc lints suppressed
// because the public surface is gRPC + integration-tested.
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
    clippy::too_many_lines,
    clippy::needless_pass_by_value,
    clippy::too_many_arguments,
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

pub mod engine;
pub mod metrics;
pub mod models;
