#!/bin/bash

LawCnt=`find content/docs | grep -v -e "地方性法规\|司法解释\|行政法规\|_index.md" | grep "md" | wc -l | tr -d " "`
echo "法律:" $LawCnt
sed -i "" "s/法律: .*部 \[^1\]/法律: $LawCnt 部 \[^1\]/g" "content/_index.md"

LawCnt=`find content/docs | grep "司法解释" | grep -v "_index.md" | grep "md" | wc -l | tr -d " "`

sed -i "" "s/司法解释: .*部/司法解释: $LawCnt 部/g" "content/_index.md"

LawCnt=`find content/docs | grep "行政法规" | grep -v "_index.md" | grep "md" | wc -l | tr -d " "`

sed -i "" "s/行政法规: .*部/行政法规: $LawCnt 部/g" "content/_index.md"

sed -i "" "/地方性法规/,/更新时间/{/^ - /!d;}" "content/_index.md"

StartLine=$((`awk '/地方性法规/{ print NR; exit }' content/_index.md` + 1))
M="c\\"
for dir in content/docs/地方性法规/*/; do
    LawCnt=`find $dir | grep -v "_index.md" | grep "md" | wc -l | tr -d " "`
    dir=`basename $dir`
    sed -i "" "$StartLine i\\
	- $dir: $LawCnt 部
    " "content/_index.md"
done