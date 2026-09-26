"""Regression tests for the MQTT TLS configuration surface
(docs/security-findings.md F6).

The finding was not "TLS is broken" - it was that TLS support did not
exist in the config at all, so enabling it meant editing code. That
contradicted this project's own config-over-hardcoding principle, which
docs/11-aws-migration.md audits and depends on. These tests assert the
knobs exist, are env-overridable, and default to off so the local stack
keeps working unchanged.

The actual TLS handshake is verified separately against a real broker
(`make mqtt-tls-check`, and a paho connect with a trusted vs. untrusted
CA) - a unit test cannot prove certificate verification works.
"""
import os
from unittest.mock import patch

from robot_agent.config import load_config

_REQUIRED_ENV = {"MQTT_ROBOT_PASSWORD": "x"}


def _config(**env):
    with patch.dict(os.environ, {**_REQUIRED_ENV, **env}, clear=False):
        return load_config()


def test_tls_is_off_by_default():
    """The local stack talks over an internal Docker network; turning TLS
    on by default would break `docker compose up` for everyone."""
    config = _config()

    assert config.mqtt.tls_enabled is False


def test_tls_can_be_enabled_by_environment_alone():
    """The whole point of F6 - a deployment change, not a code change."""
    config = _config(
        MQTT_TLS_ENABLED="true",
        MQTT_TLS_CA_CERTS="/mosquitto/certs/ca.crt",
    )

    assert config.mqtt.tls_enabled is True
    assert config.mqtt.tls_ca_certs == "/mosquitto/certs/ca.crt"


def test_client_certificate_paths_are_configurable():
    """Unused today (auth is username/password over TLS) but these are the
    knobs the per-device x509 work needs - target-architecture.md D3."""
    config = _config(
        MQTT_TLS_ENABLED="true",
        MQTT_TLS_CERTFILE="/certs/robot.crt",
        MQTT_TLS_KEYFILE="/certs/robot.key",
    )

    assert config.mqtt.tls_certfile == "/certs/robot.crt"
    assert config.mqtt.tls_keyfile == "/certs/robot.key"


def test_falsey_strings_do_not_enable_tls():
    """bool("false") is True in Python - the classic env-var footgun. If
    this regresses, someone setting MQTT_TLS_ENABLED=false gets TLS
    switched ON and a confusing connection failure."""
    for value in ("false", "False", "0", "no", "off", ""):
        assert _config(MQTT_TLS_ENABLED=value).mqtt.tls_enabled is False, value


def test_truthy_strings_enable_tls():
    for value in ("true", "True", "1", "yes", "on"):
        assert _config(MQTT_TLS_ENABLED=value).mqtt.tls_enabled is True, value


def test_insecure_mode_is_off_by_default():
    """tls_insecure disables hostname verification, which removes most of
    the value of TLS - it must never be the default."""
    config = _config(MQTT_TLS_ENABLED="true")

    assert config.mqtt.tls_insecure is False
