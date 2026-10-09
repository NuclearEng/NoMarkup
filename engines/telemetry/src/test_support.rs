//! An in-memory [`SpanExporter`] for this crate's own tests and benches.
//!
//! The SDK ships `InMemorySpanExporter`, but it lives behind
//! `opentelemetry_sdk/testing`, and that feature force-enables `rt-async-std`
//! — pulling the whole async-std runtime (21 crates: `async-io`, `polling`,
//! `blocking`, `async-process`, …) into the dependency graph to obtain a
//! `Vec<SpanData>`. CLAUDE.md §15 asks for minimal, scrutinised dependencies,
//! and this is ~30 lines against 21 crates of build-time surface.
//!
//! Compiled only when the `test-util` feature is on, which the crate's own
//! dev-dependencies enable and nothing else does.

use std::sync::{Arc, Mutex};

use futures_util::future::BoxFuture;
use opentelemetry_sdk::export::trace::{ExportResult, SpanData, SpanExporter};

/// Accumulates every exported span in memory.
///
/// Cloning shares the same buffer, so the handle kept by the test and the one
/// handed to the `TracerProvider` observe the same spans.
#[derive(Debug, Clone, Default)]
pub struct CollectingExporter {
    spans: Arc<Mutex<Vec<SpanData>>>,
}

impl CollectingExporter {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Every span exported so far.
    ///
    /// A poisoned lock yields an empty vec rather than panicking: the only way
    /// to poison it is a test that already failed, and a second panic here
    /// would bury the first one's message.
    #[must_use]
    pub fn finished_spans(&self) -> Vec<SpanData> {
        self.spans
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    /// Drop everything collected so far.
    pub fn reset(&self) {
        if let Ok(mut guard) = self.spans.lock() {
            guard.clear();
        }
    }
}

impl SpanExporter for CollectingExporter {
    fn export(&mut self, batch: Vec<SpanData>) -> BoxFuture<'static, ExportResult> {
        if let Ok(mut guard) = self.spans.lock() {
            guard.extend(batch);
        }
        Box::pin(std::future::ready(Ok(())))
    }
}
