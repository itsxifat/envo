#!/usr/bin/env bash
# Envo: install build deps and compile Asterisk 22 LTS from source.
# Safe for a shared production host: no upgrades of installed packages, no automatic service restarts,
# compile runs at low CPU/IO priority.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 NEEDRESTART_MODE=l

PKGS="build-essential autoconf automake libtool pkg-config wget curl ca-certificates git subversion bzip2 patch
libedit-dev libjansson-dev libxml2-dev uuid-dev libsqlite3-dev libssl-dev libncurses-dev libnewt-dev
libsrtp2-dev libspeex-dev libspeexdsp-dev libopus-dev libogg-dev libvorbis-dev libcurl4-openssl-dev libpq-dev
libgsm1-dev libsndfile1-dev libcap-dev libpopt-dev libical-dev libneon27-dev libiksemel-dev libunbound-dev
liburiparser-dev xmlstarlet unixodbc-dev libasound2-dev ffmpeg sox fail2ban"

echo "[envo] $(date) installing packages"
apt-get update -qq
apt-get install -y -q --no-upgrade $PKGS libkrb5-3 libgssapi-krb5-2 >/dev/null
# fail2ban ships with an sshd jail enabled; leave SSH behaviour exactly as it was until we configure jails.
systemctl stop fail2ban || true

mkdir -p /usr/src/envo && cd /usr/src/envo
if [ ! -f asterisk-22-current.tar.gz ]; then
  wget -q https://downloads.asterisk.org/pub/telephony/asterisk/asterisk-22-current.tar.gz
fi
rm -rf asterisk-22.*/
tar xzf asterisk-22-current.tar.gz
cd asterisk-22.*/
echo "[envo] $(date) building $(basename "$PWD")"

./configure --with-pjproject-bundled --with-jansson-bundled=no --libdir=/usr/lib > /usr/src/envo/configure.log 2>&1
make menuselect.makeopts >/dev/null
menuselect/menuselect \
  --disable BUILD_NATIVE \
  --enable codec_opus \
  --enable cdr_pgsql --enable cel_pgsql --enable res_config_pgsql \
  --enable CORE-SOUNDS-EN-WAV --enable CORE-SOUNDS-EN-ULAW --enable CORE-SOUNDS-EN-G722 \
  --enable EXTRA-SOUNDS-EN-WAV --enable EXTRA-SOUNDS-EN-ULAW --enable EXTRA-SOUNDS-EN-G722 \
  --enable MOH-OPSOUND-WAV --enable MOH-OPSOUND-ULAW --enable MOH-OPSOUND-G722 \
  menuselect.makeopts

nice -n 15 ionice -c3 make -j3 > /usr/src/envo/make.log 2>&1
make install > /usr/src/envo/install.log 2>&1
make install-logrotate >> /usr/src/envo/install.log 2>&1 || true
ldconfig
echo "[envo] $(date) DONE $(/usr/sbin/asterisk -V)"
